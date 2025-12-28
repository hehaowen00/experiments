package main

import (
	"log"
	"net"
	"net/http"
	"strings"

	"github.com/skip2/go-qrcode"
	"golang.design/x/clipboard"
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

	port := ":8080"
	ip := GetOutboundIP()
	png, err := qrcode.Encode("http://"+ip.String()+port, qrcode.High, 400)
	_ = err

	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "index.html")
	})

	mux.HandleFunc("GET /addr.png", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Content-Type", "image/png")
		w.Write(png)
	})

	mux.HandleFunc("POST /api", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Access-Control-Allow-Methods", "*")
		r.ParseForm()
		r.ParseMultipartForm(1024 * 1024)

		log.Println(strings.TrimSpace(r.FormValue("input")))
		clipboard.Write(clipboard.FmtText, []byte(r.FormValue("input")))
		http.Redirect(w, r, "/", http.StatusPermanentRedirect)
	})

	log.Println("serving on http://" + ip.String() + ":8080")

	http.ListenAndServe(":8080", mux)
}
