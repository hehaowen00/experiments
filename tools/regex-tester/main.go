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

	corsMiddleware := func(next func(w http.ResponseWriter, r *http.Request)) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Set common CORS headers for all requests
			w.Header().Set("Access-Control-Allow-Origin", "http://localhost:8888")
			w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, DELETE, PUT")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Max-Age", "86400")
			w.Header().Set("Connection", "keep-alive") //

			if r.Method == "OPTIONS" {
				w.WriteHeader(http.StatusOK) // Respond with 200 OK for OPTIONS requests
				return
			}

			// Pass control to the next handler
			next(w, r)
		})
	}

	mux.Handle("/", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		http.ServeFile(w, r, "index.html")
	}))

	mux.Handle("/match", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		req := Request{}

		err := json.NewDecoder(r.Body).Decode(&req)
		if err != nil {
			panic(err)
		}

		re := regexp.MustCompile(req.Pattern)
		matched := re.MatchString(req.Content)

		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(matched)
	}))

	mux.Handle("/submatch", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		req := Request{}

		err := json.NewDecoder(r.Body).Decode(&req)
		if err != nil {
			panic(err)
		}

		re := regexp.MustCompile(req.Pattern)
		results := re.FindStringSubmatch(req.Content)

		w.Header().Set("Access-Control-Allow-Origin", "*")
		json.NewEncoder(w).Encode(results)
	}))

	http.ListenAndServe(":8888", mux)
}
