package main

type Connection struct {
	Driver string
	Name   string

	FilePath string

	Host             string
	Username         string
	Password         string
	Port             int
	Database         string
	ShowAllDatabases bool
}
