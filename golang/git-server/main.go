package main

import (
	"net"
	"os"
	"path/filepath"

	"golang.org/x/crypto/ssh"
)

func makeServerConfig() ssh.ServerConfig {
	cfg := ssh.ServerConfig{
		PublicKeyCallback: func(conn ssh.ConnMetadata, key ssh.PublicKey) (*ssh.Permissions, error) {
			return nil, nil
		},
	}

	keypath := filepath.Join("./", "keys")
	if _, err := os.Stat(keypath); !os.IsExist(err) {
		os.MkdirAll(keypath, os.ModePerm)
	}

	return cfg
}

func main() {
	cfg := makeServerConfig()

	listener, err := net.Listen("tcp", "0.0.0.0:8000")
	if err != nil {
		panic(err)
	}

	for {
		conn, err := listener.Accept()
		if err != nil {
			continue
		}

		sConn, chans, reqs, err := ssh.NewServerConn(conn, &cfg)
		if err != nil {
			continue
		}

		go func() {
			for m := range reqs {
				_ = m
			}
		}()

		go func(cfg *ssh.ServerConn, chans <-chan ssh.NewChannel) {
		}(sConn, chans)
	}
}
