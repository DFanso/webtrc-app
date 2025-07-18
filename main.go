package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	_ "github.com/mattn/go-sqlite3"
	"golang.org/x/crypto/bcrypt"
)

var (
	db       *sql.DB
	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
	clients = make(map[*websocket.Conn]bool)
	channels = make(map[string]map[*websocket.Conn]*User)
	broadcast = make(chan Message)
)

type User struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	Password string `json:"-"`
	Conn     *websocket.Conn `json:"-"`
}

type Message struct {
	Type      string      `json:"type"`
	Username  string      `json:"username"`
	Content   string      `json:"content"`
	Channel   string      `json:"channel"`
	Timestamp time.Time   `json:"timestamp"`
	Data      interface{} `json:"data,omitempty"`
}

type Channel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func main() {
	initDB()
	defer db.Close()

	r := mux.NewRouter()
	
	r.HandleFunc("/", serveHome)
	r.HandleFunc("/register", handleRegister).Methods("POST")
	r.HandleFunc("/login", handleLogin).Methods("POST")
	r.HandleFunc("/ws", handleWebSocket)
	r.HandleFunc("/app.js", serveJS)
	r.PathPrefix("/static/").Handler(http.StripPrefix("/static/", http.FileServer(http.Dir("./static/"))))

	go handleMessages()

	fmt.Println("Server starting on :8081")
	log.Fatal(http.ListenAndServe(":8081", r))
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./app.db")
	if err != nil {
		log.Fatal(err)
	}

	createTables()
}

func createTables() {
	userTable := `
	CREATE TABLE IF NOT EXISTS users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	channelTable := `
	CREATE TABLE IF NOT EXISTS channels (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);`

	messageTable := `
	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL,
		content TEXT NOT NULL,
		channel_id TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (channel_id) REFERENCES channels(id)
	);`

	_, err := db.Exec(userTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(channelTable)
	if err != nil {
		log.Fatal(err)
	}

	_, err = db.Exec(messageTable)
	if err != nil {
		log.Fatal(err)
	}

	// Insert default channel
	_, err = db.Exec("INSERT OR IGNORE INTO channels (id, name) VALUES ('general', 'General')")
	if err != nil {
		log.Fatal(err)
	}
}

func serveHome(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "static/index.html")
}

func serveJS(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/javascript")
	http.ServeFile(w, r, "static/app.js")
}

func handleRegister(w http.ResponseWriter, r *http.Request) {
	var user User
	json.NewDecoder(r.Body).Decode(&user)

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(user.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Error hashing password", http.StatusInternalServerError)
		return
	}

	_, err = db.Exec("INSERT INTO users (username, password) VALUES (?, ?)", user.Username, string(hashedPassword))
	if err != nil {
		http.Error(w, "Username already exists", http.StatusConflict)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]string{"message": "User registered successfully"})
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	var loginUser User
	json.NewDecoder(r.Body).Decode(&loginUser)

	var user User
	err := db.QueryRow("SELECT id, username, password FROM users WHERE username = ?", loginUser.Username).Scan(&user.ID, &user.Username, &user.Password)
	if err != nil {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	err = bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(loginUser.Password))
	if err != nil {
		http.Error(w, "Invalid credentials", http.StatusUnauthorized)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"message": "Login successful",
		"user": map[string]interface{}{
			"id": user.ID,
			"username": user.Username,
		},
	})
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println(err)
		return
	}
	defer conn.Close()

	clients[conn] = true

	for {
		var msg Message
		err := conn.ReadJSON(&msg)
		if err != nil {
			log.Println(err)
			delete(clients, conn)
			break
		}

		msg.Timestamp = time.Now()
		
		switch msg.Type {
		case "join_channel":
			joinChannel(conn, msg.Username, msg.Channel)
		case "leave_channel":
			leaveChannel(conn, msg.Username, msg.Channel)
		case "message":
			saveMessage(msg)
			broadcast <- msg
		case "webrtc_offer", "webrtc_answer", "webrtc_ice_candidate":
			handleWebRTCSignaling(msg)
		}
	}
}

func joinChannel(conn *websocket.Conn, username, channelID string) {
	if channels[channelID] == nil {
		channels[channelID] = make(map[*websocket.Conn]*User)
	}
	
	user := &User{Username: username, Conn: conn}
	channels[channelID][conn] = user

	msg := Message{
		Type:      "user_joined",
		Username:  username,
		Channel:   channelID,
		Timestamp: time.Now(),
	}
	
	broadcastToChannel(channelID, msg)
}

func leaveChannel(conn *websocket.Conn, username, channelID string) {
	if channels[channelID] != nil {
		delete(channels[channelID], conn)
		
		msg := Message{
			Type:      "user_left",
			Username:  username,
			Channel:   channelID,
			Timestamp: time.Now(),
		}
		
		broadcastToChannel(channelID, msg)
	}
}

func saveMessage(msg Message) {
	_, err := db.Exec("INSERT INTO messages (username, content, channel_id) VALUES (?, ?, ?)", msg.Username, msg.Content, msg.Channel)
	if err != nil {
		log.Println("Error saving message:", err)
	}
}

func handleWebRTCSignaling(msg Message) {
	broadcastToChannel(msg.Channel, msg)
}

func broadcastToChannel(channelID string, msg Message) {
	if channels[channelID] != nil {
		for conn := range channels[channelID] {
			err := conn.WriteJSON(msg)
			if err != nil {
				log.Println(err)
				conn.Close()
				delete(channels[channelID], conn)
			}
		}
	}
}

func handleMessages() {
	for {
		msg := <-broadcast
		broadcastToChannel(msg.Channel, msg)
	}
}