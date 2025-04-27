package main

import (
	"log"
	"mime"
	"time"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapclient"
	"github.com/emersion/go-message/charset"
	"github.com/emersion/go-sasl"
)

const (
	USERNAME = ""
	PASSWORD = ""
)

func main() {
	opts := &imapclient.Options{
		WordDecoder: &mime.WordDecoder{CharsetReader: charset.Reader},
	}

	client, err := imapclient.DialTLS("imap.gmail.com:993", opts)
	if err != nil {
		panic(err)
	}

	err = client.Authenticate(sasl.NewPlainClient("", USERNAME, PASSWORD))
	if err != nil {
		panic(err)
	}

	selectTx := client.Select("INBOX", &imap.SelectOptions{})
	mbox, err := selectTx.Wait()
	if err != nil {
		panic(err)
	}

	log.Println("Num Messages:", mbox.NumMessages)

	criteria := &imap.SearchCriteria{Since: time.Now().Add(-24 * time.Hour)}
	searchTx := client.UIDSearch(criteria, &imap.SearchOptions{ReturnAll: true})
	searchData, err := searchTx.Wait()
	if err != nil {
		panic(err)
	}

	if len(searchData.AllUIDs()) == 0 {
		log.Println("No messages found")
		return
	}

	log.Println(searchData.AllSeqNums())
	log.Println(searchData.AllUIDs())

	seqSet := imap.UIDSetNum(1)
	bodySection := &imap.FetchItemBodySection{}
	fetchOptions := &imap.FetchOptions{
		UID:         true,
		Envelope:    true,
		Flags:       true,
		BodySection: []*imap.FetchItemBodySection{bodySection},
	}

	fetchTx := client.Fetch(seqSet, fetchOptions)
	defer fetchTx.Close()

	for {
		msg := fetchTx.Next()
		if msg == nil {
			break
		}

		buf, err := msg.Collect()
		if err != nil {
			panic(err)
		}

		log.Printf("UID: %v\n", buf.UID)
		log.Printf("Date: %v\n", buf.Envelope.Date)
		log.Printf("From: %v\n", buf.Envelope.From)
		log.Printf("To: %v\n", buf.Envelope.To)
		log.Printf("Subject: %v\n", buf.Envelope.Subject)
	}
}
