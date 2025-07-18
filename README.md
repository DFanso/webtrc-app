# WebRTC Voice Chat Application

A real-time voice chat application built with Go, WebRTC, SQLite, and TailwindCSS.

## Features

- **User Registration & Authentication**: Secure user registration and login system
- **Voice Channels**: Join voice channels and communicate with other users
- **Real-time Messaging**: Send and receive text messages instantly
- **WebRTC Audio**: High-quality peer-to-peer voice communication
- **SQLite Database**: Persistent storage for users, channels, and messages
- **Modern UI**: Clean, responsive interface built with TailwindCSS

## Requirements

- Go 1.21 or higher
- Modern web browser with WebRTC support
- Microphone access (for voice features)

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd webtrc-app
   ```

2. Install dependencies:
   ```bash
   go mod tidy
   ```

3. Run the application:
   ```bash
   go run main.go
   ```

4. Open your browser and navigate to `http://localhost:8080`

## Usage

1. **Registration**: Create a new account by clicking the "Register" tab and filling in your credentials
2. **Login**: Sign in with your username and password
3. **Grant Permissions**: Allow microphone access when prompted (required for voice chat)
4. **Join Channel**: Click on a voice channel to join it
5. **Voice Chat**: Speak and hear other users in the same channel
6. **Text Messages**: Type messages in the chat input to communicate
7. **Mute/Unmute**: Use the microphone button to mute/unmute yourself

## Technical Details

### Backend (Go)
- **Web Server**: Gorilla Mux for HTTP routing
- **WebSocket**: Gorilla WebSocket for real-time communication
- **Database**: SQLite with go-sqlite3 driver
- **Authentication**: bcrypt for password hashing
- **WebRTC Signaling**: Custom signaling server for WebRTC coordination

### Frontend
- **HTML5**: Semantic markup structure
- **TailwindCSS**: Utility-first CSS framework for styling
- **JavaScript**: WebRTC API for peer-to-peer communication
- **WebSocket**: Real-time bidirectional communication

### Database Schema
- **users**: User accounts with encrypted passwords
- **channels**: Voice channels for organizing conversations
- **messages**: Persistent text message history

## File Structure

```
webtrc-app/
├── main.go           # Go server application
├── go.mod           # Go module dependencies
├── app.db           # SQLite database (created automatically)
├── static/
│   ├── index.html   # Frontend HTML
│   └── app.js       # Frontend JavaScript
└── README.md        # This file
```

## Security Features

- Password hashing with bcrypt
- WebSocket origin validation
- CORS handling for WebRTC
- SQL injection prevention with prepared statements

## Browser Compatibility

This application requires a modern browser with WebRTC support:
- Chrome 23+
- Firefox 22+
- Safari 11+
- Edge 12+

## Troubleshooting

1. **Microphone Access Denied**: Ensure your browser has microphone permissions
2. **Connection Issues**: Check if port 8080 is available
3. **Audio Problems**: Verify your microphone is working and not muted
4. **Database Errors**: Ensure write permissions in the application directory

## Development

To modify the application:

1. Edit `main.go` for backend changes
2. Edit `static/index.html` for UI changes
3. Edit `static/app.js` for frontend functionality
4. Restart the server after backend changes

## License

This project is open source and available under the MIT License.