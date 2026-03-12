package main

import (
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"regexp"
	"syscall"

	"golang.org/x/crypto/ssh"
)

var gitCmdRe = regexp.MustCompile(`^(git-upload-pack|git-receive-pack)\s+'?/?([^']+)'?$`)

var gitPath string

func cmdServe(args []string) {
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	port := fs.Int("port", 0, "Listen port (0 = ephemeral)")
	dbPath := fs.String("db", "", "Path to gitsync.db")
	hostKeyPath := fs.String("host-key", "", "Path to SSH host key")
	fs.StringVar(&gitPath, "git-path", "", "Directory containing git binaries (optional)")
	fs.Parse(args)

	if *dbPath == "" || *hostKeyPath == "" {
		fmt.Fprintf(os.Stderr, "Both --db and --host-key are required\n")
		os.Exit(1)
	}

	db := openDB(*dbPath)
	defer db.Close()

	hostKeyBytes, err := os.ReadFile(*hostKeyPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to read host key: %v\n", err)
		os.Exit(1)
	}

	hostKey, err := ssh.ParsePrivateKey(hostKeyBytes)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to parse host key: %v\n", err)
		os.Exit(1)
	}

	config := &ssh.ServerConfig{
		// Authenticate by peerId (sent as username), accept any password
		PasswordCallback: func(conn ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
			peerId := conn.User()
			if checkPeerAccepted(db, peerId) {
				return nil, nil
			}
			return nil, fmt.Errorf("peer not accepted: %s", peerId)
		},
	}
	config.AddHostKey(hostKey)

	listener, err := net.Listen("tcp", fmt.Sprintf(":%d", *port))
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to listen: %v\n", err)
		os.Exit(1)
	}

	actualPort := listener.Addr().(*net.TCPAddr).Port
	fmt.Fprintf(os.Stdout, "PORT=%d\n", actualPort)
	os.Stdout.Sync()

	// Handle graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		listener.Close()
		os.Exit(0)
	}()

	for {
		tcpConn, err := listener.Accept()
		if err != nil {
			break
		}
		go handleConn(tcpConn, config, db)
	}
}

func handleConn(tcpConn net.Conn, config *ssh.ServerConfig, db *DB) {
	defer tcpConn.Close()

	sshConn, chans, reqs, err := ssh.NewServerConn(tcpConn, config)
	if err != nil {
		return
	}
	defer sshConn.Close()

	go ssh.DiscardRequests(reqs)

	for newChannel := range chans {
		if newChannel.ChannelType() != "session" {
			newChannel.Reject(ssh.UnknownChannelType, "unknown channel type")
			continue
		}

		channel, requests, err := newChannel.Accept()
		if err != nil {
			continue
		}

		go handleSession(channel, requests, db)
	}
}

func handleSession(channel ssh.Channel, requests <-chan *ssh.Request, db *DB) {
	defer channel.Close()

	for req := range requests {
		if req.Type != "exec" {
			if req.WantReply {
				req.Reply(false, nil)
			}
			continue
		}

		// Parse the exec payload: uint32 length + string command
		if len(req.Payload) < 4 {
			req.Reply(false, nil)
			continue
		}
		cmdLen := uint32(req.Payload[0])<<24 | uint32(req.Payload[1])<<16 |
			uint32(req.Payload[2])<<8 | uint32(req.Payload[3])
		if uint32(len(req.Payload)-4) < cmdLen {
			req.Reply(false, nil)
			continue
		}
		command := string(req.Payload[4 : 4+cmdLen])

		req.Reply(true, nil)

		matches := gitCmdRe.FindStringSubmatch(command)
		if matches == nil {
			channel.Stderr().Write([]byte("Invalid command\n"))
			sendExitStatus(channel, 1)
			return
		}

		service := matches[1]
		exportName := matches[2]
		repoPath, err := resolveRepo(db, exportName)
		if err != nil || repoPath == "" {
			channel.Stderr().Write([]byte(fmt.Sprintf("Repository not found: %s\n", exportName)))
			sendExitStatus(channel, 1)
			return
		}

		serviceBin := service
		if gitPath != "" {
			serviceBin = gitPath + "/" + service
		}
		proc := exec.Command(serviceBin, repoPath)
		proc.Stdin = channel
		procStdout, _ := proc.StdoutPipe()
		procStderr, _ := proc.StderrPipe()

		if err := proc.Start(); err != nil {
			channel.Stderr().Write([]byte(fmt.Sprintf("Error: %v\n", err)))
			sendExitStatus(channel, 1)
			return
		}

		go io.Copy(channel, procStdout)
		go io.Copy(channel.Stderr(), procStderr)

		exitCode := 0
		if err := proc.Wait(); err != nil {
			if exitErr, ok := err.(*exec.ExitError); ok {
				exitCode = exitErr.ExitCode()
			} else {
				exitCode = 1
			}
		}
		sendExitStatus(channel, uint32(exitCode))
		return
	}
}

func sendExitStatus(channel ssh.Channel, code uint32) {
	payload := []byte{byte(code >> 24), byte(code >> 16), byte(code >> 8), byte(code)}
	channel.SendRequest("exit-status", false, payload)
}
