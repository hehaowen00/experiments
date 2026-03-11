package main

import (
	"fmt"
	"os"
	"time"
	"strings"

	"golang.org/x/crypto/ssh"
)

func cmdConnect(args []string) {
	port := "22"
	user := ""
	host := ""
	var cmdParts []string

	i := 0
	for i < len(args) {
		arg := args[i]
		switch {
		case arg == "-p" && i+1 < len(args):
			i++
			port = args[i]
		case arg == "-l" && i+1 < len(args):
			i++
			user = args[i]
		case arg == "-o":
			// skip SSH options like StrictHostKeyChecking=no
			i++
		case strings.HasPrefix(arg, "-"):
			// skip unknown flags
		case host == "":
			// First non-flag arg is the host (may include user@)
			if idx := strings.Index(arg, "@"); idx >= 0 {
				user = arg[:idx]
				host = arg[idx+1:]
			} else {
				host = arg
			}
		default:
			// Everything after host is the command
			cmdParts = args[i:]
			i = len(args) // break loop
			continue
		}
		i++
	}

	command := strings.Join(cmdParts, " ")

	if host == "" || command == "" {
		fmt.Fprintf(os.Stderr, "gitsync-ssh connect: missing host or command\n")
		os.Exit(1)
	}

	config := &ssh.ClientConfig{
		User: user,
		Auth: []ssh.AuthMethod{
			ssh.Password(""), // server authenticates by username (peerId), ignores password
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	addr := fmt.Sprintf("%s:%s", host, port)
	conn, err := ssh.Dial("tcp", addr, config)
	if err != nil {
		fmt.Fprintf(os.Stderr, "gitsync-ssh connect error: %v\n", err)
		os.Exit(1)
	}
	defer conn.Close()

	session, err := conn.NewSession()
	if err != nil {
		fmt.Fprintf(os.Stderr, "gitsync-ssh session error: %v\n", err)
		os.Exit(1)
	}
	defer session.Close()

	session.Stdin = os.Stdin
	session.Stdout = os.Stdout
	session.Stderr = os.Stderr

	exitCode := 0
	if err := session.Run(command); err != nil {
		if exitErr, ok := err.(*ssh.ExitError); ok {
			exitCode = exitErr.ExitStatus()
		} else {
			fmt.Fprintf(os.Stderr, "gitsync-ssh run error: %v\n", err)
			exitCode = 1
		}
	}
	os.Exit(exitCode)
}
