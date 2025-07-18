# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a WebRTC voice chat application built with Go backend and vanilla JavaScript frontend. The application enables real-time voice communication between users in channels, with persistent text messaging and user authentication.

## Development Commands

### Running the Application
```bash
go run main.go
```
Server starts on port 8081 (note: README mentions 8080 but code uses 8081)

### Build Commands
```bash
go build -o tmp/main.exe main.go
```

### Dependency Management
```bash
go mod tidy
go mod download
```

### Testing
No test files or test commands are currently configured in this project.

## Architecture

### Backend (Go)
- **Single-file architecture**: All backend logic is in `main.go`
- **Database**: SQLite with three tables - users, channels, messages
- **WebSocket**: Real-time communication using Gorilla WebSocket
- **WebRTC Signaling**: Custom signaling server for peer-to-peer connections
- **Authentication**: bcrypt password hashing, no session management

### Frontend (JavaScript)
- **Single-page application**: `static/index.html` with `static/app.js`
- **WebRTC Client**: Handles peer-to-peer audio connections
- **WebSocket Client**: Real-time messaging and signaling
- **Styling**: TailwindCSS via CDN

### Key Data Structures
- `User`: ID, Username, Password, WebSocket connection
- `Message`: Type, Username, Content, Channel, Timestamp, Data
- `Channel`: ID, Name (currently only "general" channel exists)

### WebSocket Message Types
- `join_channel`: User joins a voice channel
- `leave_channel`: User leaves a voice channel  
- `message`: Text message
- `webrtc_offer`: WebRTC connection offer
- `webrtc_answer`: WebRTC connection answer
- `webrtc_ice_candidate`: ICE candidate for WebRTC

### Database Schema
- **users**: id, username, password, created_at
- **channels**: id, name, created_at
- **messages**: id, username, content, channel_id, created_at

## Key Components

### Go Backend (`main.go`)
- `main()`: Server initialization and routing (line 50)
- `initDB()`: Database initialization (line 69)
- `handleWebSocket()`: WebSocket connection handler (line 182)
- `handleWebRTCSignaling()`: WebRTC signaling relay (line 257)
- `broadcastToChannel()`: Channel-specific message broadcasting (line 261)

### JavaScript Frontend (`static/app.js`)
- `WebRTCChat` class: Main application controller
- WebRTC peer connection management
- WebSocket message handling
- UI state management

## Development Notes

### File Structure
```
webtrc-app/
├── main.go           # Complete Go backend
├── go.mod           # Go dependencies
├── app.db           # SQLite database (auto-created)
├── static/
│   ├── index.html   # Frontend HTML
│   └── app.js       # Frontend JavaScript
└── tmp/             # Build output directory
```

### Dependencies
- `github.com/gorilla/mux`: HTTP routing
- `github.com/gorilla/websocket`: WebSocket support
- `github.com/mattn/go-sqlite3`: SQLite driver
- `golang.org/x/crypto/bcrypt`: Password hashing

### Important Implementation Details
- All WebSocket connections are stored in global `clients` map
- Channel membership tracked in `channels` map
- No authentication middleware - auth handled per-request
- WebRTC signaling is stateless relay through WebSocket
- Database uses prepared statements for security
- CORS is permissive for WebRTC (CheckOrigin returns true)

### Port Configuration
The application runs on port 8081 (main.go:66), though README references port 8080.