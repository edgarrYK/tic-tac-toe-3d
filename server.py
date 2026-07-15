import json
import uuid
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
import uvicorn

app = FastAPI()

# --- ESTADO DEL JUEGO ---
rooms = {}

C = [
    [1,1,0], [1,0,1], [0,1,1], [1,0,0], [1,-1,0], [0,0,1], [-1,0,1], 
    [0,1,0], [0,1,-1], [0,-1,-1], [0,-1,0], [0,0,-1], [0,0,0]
]

def create_empty_board():
    return [[[0 for _ in range(4)] for _ in range(4)] for _ in range(4)]

def check_win(board, Z, Y, X):
    for c in range(13):
        tz = C[c][0]
        ty = C[c][1]
        tx = C[c][2]
        
        z1 = Z if tz > 0 else -1
        y1 = Y if ty > 0 else -1
        x1 = X if tx > 0 else -1
        
        s = 0
        line_coords = []
        for i in range(4):
            z = Z if z1 >= 0 else (3 - i if tz else i)
            y = Y if y1 >= 0 else (3 - i if ty else i)
            x = X if x1 >= 0 else (3 - i if tx else i)
            
            if 0 <= z < 4 and 0 <= y < 4 and 0 <= x < 4:
                s += board[z][y][x]
                line_coords.append({'x': x, 'y': y, 'z': z})
            else:
                break
                
        if len(line_coords) == 4 and (s == 4 or s == -4):
            return True, line_coords
    return False, []

async def broadcast_room(room_id):
    room = rooms.get(room_id)
    if not room: return
    
    state = {
        'type': 'state_update',
        'board': room['board'],
        'turn': room['turn'],
        'winner': room['winner'],
        'winning_line': room['winning_line'],
        'players_count': len(room['players'])
    }
    
    for ws in list(room['players'].keys()):
        try:
            await ws.send_json(state)
        except:
            pass

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    current_room = None
    player_symbol = None

    try:
        while True:
            data = await websocket.receive_json()
            action = data.get('action')

            if action == 'create_room':
                room_id = str(uuid.uuid4())[:6].upper()
                rooms[room_id] = {
                    'players': {websocket: 'X'},
                    'board': create_empty_board(),
                    'turn': 'X',
                    'winner': None,
                    'winning_line': []
                }
                current_room = room_id
                player_symbol = 'X'
                await websocket.send_json({'type': 'room_created', 'room_id': room_id, 'symbol': 'X'})
                await broadcast_room(room_id)

            elif action == 'join_room':
                room_id = data.get('room_id').upper()
                if room_id in rooms and len(rooms[room_id]['players']) < 2:
                    current_room = room_id
                    player_symbol = 'O'
                    rooms[room_id]['players'][websocket] = 'O'
                    await websocket.send_json({'type': 'room_joined', 'room_id': room_id, 'symbol': 'O'})
                    await broadcast_room(room_id)
                else:
                    await websocket.send_json({'type': 'error', 'message': 'Sala llena o no existe'})

            elif action == 'make_move':
                if not current_room or rooms[current_room]['winner']: continue
                room = rooms[current_room]
                
                if room['turn'] != player_symbol:
                    continue
                
                x, y, z = data.get('x'), data.get('y'), data.get('z')
                if not (0 <= x < 4 and 0 <= y < 4 and 0 <= z < 4):
                    continue
                if room['board'][z][y][x] != 0:
                    continue
                
                val = -1 if player_symbol == 'X' else 1
                room['board'][z][y][x] = val
                
                is_win, win_line = check_win(room['board'], z, y, x)
                if is_win:
                    room['winner'] = player_symbol
                    room['winning_line'] = win_line
                else:
                    room['turn'] = 'O' if player_symbol == 'X' else 'X'
                    
                await broadcast_room(current_room)
                
            elif action == 'restart_game':
                if current_room and current_room in rooms:
                    rooms[current_room]['board'] = create_empty_board()
                    rooms[current_room]['turn'] = 'X'
                    rooms[current_room]['winner'] = None
                    rooms[current_room]['winning_line'] = []
                    await broadcast_room(current_room)

    except WebSocketDisconnect:
        if current_room and current_room in rooms:
            if websocket in rooms[current_room]['players']:
                del rooms[current_room]['players'][websocket]
            if len(rooms[current_room]['players']) == 0:
                del rooms[current_room]
            else:
                await broadcast_room(current_room)

# Montar los archivos estáticos en la raíz
# Así, FastAPI servirá el index.html y assets en el mismo puerto que los WebSockets
app.mount("/", StaticFiles(directory="client", html=True), name="client")

if __name__ == "__main__":
    # Obtener el puerto desde las variables de entorno (Render usa la variable PORT)
    port = int(os.environ.get("PORT", 8082))
    print(f"Iniciando aplicación unificada en el puerto {port}...")
    uvicorn.run(app, host="0.0.0.0", port=port)
