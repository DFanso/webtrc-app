package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
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
	clients   = make(map[*websocket.Conn]bool)
	channels  = make(map[string]map[*websocket.Conn]*User)
	broadcast = make(chan Message)
	// WebRTC-related variables removed - using WebSocket audio streaming
)

type User struct {
	ID       int             `json:"id"`
	Username string          `json:"username"`
	Password string          `json:"-"`
	Conn     *websocket.Conn `json:"-"`
	WriteMu  sync.Mutex      `json:"-"`
}

type Message struct {
	Type       string      `json:"type"`
	Username   string      `json:"username"`
	Content    string      `json:"content"`
	Channel    string      `json:"channel"`
	Timestamp  time.Time   `json:"timestamp"`
	Data       interface{} `json:"data,omitempty"`
	AudioData  string      `json:"audioData,omitempty"`
	SampleRate int         `json:"sampleRate,omitempty"`
}

type Channel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// SFU functions removed - using WebSocket audio streaming

func main() {
	initDB()
	defer db.Close()

	// SFU initialization removed - using WebSocket audio streaming

	r := mux.NewRouter()

	r.HandleFunc("/", serveHome)
	r.HandleFunc("/register", handleRegister).Methods("POST")
	r.HandleFunc("/login", handleLogin).Methods("POST")
	r.HandleFunc("/ws", handleWebSocket)
	// SFU endpoint removed - using WebSocket audio streaming instead
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
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
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
			"id":       user.ID,
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

			// Remove user from all channels
			for channelID, channelUsers := range channels {
				if user, exists := channelUsers[conn]; exists {
					delete(channelUsers, conn)
					// Notify other users in the channel
					leaveMsg := Message{
						Type:      "user_left",
						Username:  user.Username,
						Channel:   channelID,
						Timestamp: time.Now(),
					}
					broadcastToChannel(channelID, leaveMsg)
				}
			}
			break
		}

		msg.Timestamp = time.Now()

		// Only log non-audio messages to reduce spam
		if msg.Type != "audio_data" && msg.Type != "audio_chunk" {
			log.Printf("Received message: Type=%s, Username=%s, Channel=%s, Content=%s", msg.Type, msg.Username, msg.Channel, msg.Content)
		}

		switch msg.Type {
		case "join_channel":
			joinChannel(conn, msg.Username, msg.Channel)
		case "leave_channel":
			leaveChannel(conn, msg.Username, msg.Channel)
		case "message":
			saveMessage(msg)
			broadcast <- msg
		case "audio_chunk":
			// Broadcast audio chunk to all users in the channel except sender
			broadcastAudioChunk(msg)
		case "audio_data":
			// Broadcast audio data to all users in the channel except sender
			broadcastAudioChunk(msg)
		}
	}
}

func sendRecentMessages(user *User, channelID string) {
	log.Printf("Sending recent messages for channel %s", channelID)
	rows, err := db.Query("SELECT username, content, created_at FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT 50", channelID)
	if err != nil {
		log.Println("Error querying messages:", err)
		return
	}
	defer rows.Close()

	var messages []Message
	for rows.Next() {
		var msg Message
		var createdAt string
		err := rows.Scan(&msg.Username, &msg.Content, &createdAt)
		if err != nil {
			log.Println("Error scanning message:", err)
			continue
		}

		// Parse the timestamp
		timestamp, err := time.Parse("2006-01-02 15:04:05", createdAt)
		if err != nil {
			log.Printf("Error parsing timestamp '%s': %v", createdAt, err)
			// Try alternative formats
			if timestamp, err = time.Parse("2006-01-02T15:04:05Z", createdAt); err != nil {
				log.Printf("Error parsing timestamp with alternative format: %v", err)
				timestamp = time.Now() // Use current time as fallback
			}
		}

		msg.Type = "message"
		msg.Channel = channelID
		msg.Timestamp = timestamp
		messages = append(messages, msg)
	}

	log.Printf("Found %d messages for channel %s", len(messages), channelID)

	// Send messages in chronological order (reverse the slice)
	for i := len(messages) - 1; i >= 0; i-- {
		log.Printf("Sending message: %s - %s", messages[i].Username, messages[i].Content)
		err := safeWriteJSON(user, messages[i])
		if err != nil {
			log.Println("Error sending message:", err)
			break
		}
	}
}

func safeWriteJSON(user *User, msg interface{}) error {
	user.WriteMu.Lock()
	defer user.WriteMu.Unlock()
	return user.Conn.WriteJSON(msg)
}

func joinChannel(conn *websocket.Conn, username, channelID string) {
	log.Printf("User %s joining channel %s", username, channelID)
	if channels[channelID] == nil {
		channels[channelID] = make(map[*websocket.Conn]*User)
	}

	user := &User{Username: username, Conn: conn}
	channels[channelID][conn] = user
	log.Printf("Channel %s now has %d users", channelID, len(channels[channelID]))

	// Send current user list to the new user
	var userList []string
	for _, u := range channels[channelID] {
		userList = append(userList, u.Username)
	}

	userListMsg := Message{
		Type:      "user_list",
		Channel:   channelID,
		Timestamp: time.Now(),
		Data:      userList,
	}
	err := safeWriteJSON(user, userListMsg)
	if err != nil {
		log.Println("Error sending user list:", err)
	}

	// Send recent messages to the new user
	sendRecentMessages(user, channelID)

	// Notify other users that this user joined
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

func broadcastAudioChunk(msg Message) {
	// Removed excessive logging for audio broadcasts
	if channelUsers, exists := channels[msg.Channel]; exists {
		for conn, user := range channelUsers {
			// Don't send audio back to the sender
			if user.Username != msg.Username {
				err := safeWriteJSON(user, msg)
				if err != nil {
					log.Printf("Error sending audio chunk to %s: %v", user.Username, err)
					conn.Close()
					delete(channelUsers, conn)
				}
			}
		}
	}
}

func broadcastToChannel(channelID string, msg Message) {
	log.Printf("Broadcasting message to channel %s: %+v", channelID, msg)
	if channels[channelID] != nil {
		log.Printf("Channel %s has %d users", channelID, len(channels[channelID]))
		for conn, user := range channels[channelID] {
			err := safeWriteJSON(user, msg)
			if err != nil {
				log.Println("Error sending message to user:", err)
				conn.Close()
				delete(channels[channelID], conn)
			} else {
				log.Println("Message sent successfully to user")
			}
		}
	} else {
		log.Printf("Channel %s not found", channelID)
	}
}

// Old SFU structs and handlers removed - using WebSocket audio streaming

func handleMessages() {
	for {
		msg := <-broadcast
		broadcastToChannel(msg.Channel, msg)
	}
}
