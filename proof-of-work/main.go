package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math/rand/v2"
	"strconv"
	"strings"
	"time"
)

func main() {
	nonce := 0
	data := fmt.Sprintf("%d%d", rand.Int64(), rand.Int64())

	startTime := time.Now()
	target := "000000"

	fmt.Println("data", data)
	fmt.Println("target", target)

	for {
		hash := sha256.New()
		hash.Write([]byte(data + strconv.Itoa(nonce)))
		encoded := hex.EncodeToString(hash.Sum(nil))

		if strings.HasPrefix(encoded, target) {
			fmt.Println("nonce", nonce)
			fmt.Println("found", encoded)
			break
		}

		nonce++
	}

	endTime := time.Now()
	fmt.Println("elapsed", endTime.Sub(startTime))
}
