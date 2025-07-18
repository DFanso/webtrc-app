# WebSocket Voice Chat Application

A real-time voice chat application built with Go, WebSocket audio streaming, SQLite, and TailwindCSS.

## Features

- **User Registration & Authentication**: Secure user registration and login system
- **Voice Channels**: Join voice channels and communicate with other users
- **Real-time Messaging**: Send and receive text messages instantly
- **WebSocket Audio Streaming**: High-quality real-time voice communication via WebSocket
- **SQLite Database**: Persistent storage for users, channels, and messages
- **Modern UI**: Clean, responsive interface built with TailwindCSS
- **Multi-User Support**: Supports multiple users in channels with concurrent audio streams
- **Thread-Safe Architecture**: Mutex-protected WebSocket connections prevent concurrency issues

## Requirements

- Go 1.21 or higher
- Modern web browser with Web Audio API support
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

4. Open your browser and navigate to `http://localhost:8081`

## Usage

1. **Registration**: Create a new account by clicking the "Register" tab and filling in your credentials
2. **Login**: Sign in with your username and password
3. **Grant Permissions**: Allow microphone access when prompted (required for voice chat)
4. **Join Channel**: Click on a voice channel to join it
5. **Voice Chat**: Speak and hear other users in the same channel simultaneously
6. **Text Messages**: Type messages in the chat input to communicate
7. **Mute/Unmute**: Use the microphone button to mute/unmute yourself

## Technical Details

### Backend (Go)
- **Web Server**: Gorilla Mux for HTTP routing
- **WebSocket**: Gorilla WebSocket for real-time communication and audio streaming
- **Database**: SQLite with go-sqlite3 driver
- **Authentication**: bcrypt for password hashing
- **Concurrency**: Mutex-protected WebSocket writes to prevent race conditions
- **Audio Broadcasting**: Efficient audio chunk distribution to multiple users

### Frontend
- **HTML5**: Semantic markup structure
- **TailwindCSS**: Utility-first CSS framework for styling
- **JavaScript**: Web Audio API for audio capture and playback
- **WebSocket**: Real-time bidirectional communication for messages and audio
- **Audio Processing**: Base64 encoding/decoding for audio transmission

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
- SQL injection prevention with prepared statements
- Thread-safe concurrent connections

## Browser Compatibility

This application requires a modern browser with Web Audio API support:
- Chrome 25+
- Firefox 25+
- Safari 14.1+
- Edge 12+

## Troubleshooting

1. **Microphone Access Denied**: Ensure your browser has microphone permissions
2. **Connection Issues**: Check if port 8081 is available
3. **Audio Problems**: Verify your microphone is working and not muted
4. **Database Errors**: Ensure write permissions in the application directory
5. **Concurrent Write Errors**: Fixed with mutex protection in latest version

## Architecture Notes

### Audio Streaming
- Uses WebSocket for real-time audio transmission instead of WebRTC peer-to-peer
- Audio is captured via MediaRecorder API, encoded as base64, and transmitted
- Server broadcasts audio chunks to all users in the channel except the sender
- Client-side audio playback uses Web Audio API with scheduled buffer sources

### Concurrency Handling
- Each user connection has a dedicated mutex to prevent concurrent WebSocket writes
- Safe broadcasting functions ensure no race conditions during high-traffic scenarios
- Supports unlimited users per channel (limited by server resources)

## Development

To modify the application:

1. Edit `main.go` for backend changes
2. Edit `static/index.html` for UI changes
3. Edit `static/app.js` for frontend functionality
4. Restart the server after backend changes

## License

This project is open source and available under the MIT License.