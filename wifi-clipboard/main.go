package main

import (
	"log"
	"net"
	"net/http"
)

func GetOutboundIP() net.IP {
	conn, err := net.Dial("udp", "8.8.8.8:8080")
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()

	localAddr := conn.LocalAddr().(*net.UDPAddr)

	return localAddr.IP
}

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "index.html")
	})

	mux.HandleFunc("POST /api", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Access-Control-Allow-Methods", "*")
		r.ParseForm()
		r.ParseMultipartForm(1024 * 1024)

		log.Println(r.Form)

		http.Redirect(w, r, "/", http.StatusPermanentRedirect)

		// data, err := io.ReadAll(r.Body)
		// if err != nil {
		// 	panic(err)
		// }
		// val := strings.TrimPrefix(string(data), "input=")
		// if len(val) == 1 {
		// 	log.Println(val[0])
		// }
	})

	ip := GetOutboundIP()
	log.Println("serving on http://" + ip.String() + ":8080")

	http.ListenAndServe(":8080", mux)
}
