package main

import (
	"encoding/json"
	"log"
	"net/http"
	"regexp"
)

type Request struct {
	Pattern string
	Content string
}

func main() {
	re := regexp.MustCompile(`^To Record (\d+)\+ Points$`)

	log.Println(re.MatchString("To Record 10+ Points"))

	test := re.FindStringSubmatch("To Record 10+ Points")
	log.Printf("%+v %d\n", test, len(test))

	idx := len(test) - 1
	if idx >= 0 {
		last := test[idx]
		log.Println(last)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "index.html")
	})

	mux.HandleFunc("POST /match", func(w http.ResponseWriter, r *http.Request) {
		req := Request{}

		err := json.NewDecoder(r.Body).Decode(&req)
		if err != nil {
			panic(err)
		}

		re := regexp.MustCompile(req.Pattern)
		matched := re.MatchString(req.Content)

		json.NewEncoder(w).Encode(matched)
	})

	mux.HandleFunc("POST /submatch", func(w http.ResponseWriter, r *http.Request) {
		req := Request{}

		err := json.NewDecoder(r.Body).Decode(&req)
		if err != nil {
			panic(err)
		}

		re := regexp.MustCompile(req.Pattern)
		results := re.FindStringSubmatch(req.Content)
		json.NewEncoder(w).Encode(results)
	})

	http.ListenAndServe(":8888", mux)
}
