import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// --- ESTADO GLOBAL ---
let ws;
let currentRoom = null;
let mySymbol = null;
let gameBoard = []; // 3D array [z][y][x]
let currentTurn = 'X';
let winner = null;
let winningLine = [];
let lastPieceCount = 0; // Para el sonido

// --- AUDIO ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSoftSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = 'sine'; // Onda senoidal pura (muy suave para el oído)
    osc.frequency.setValueAtTime(350, audioCtx.currentTime); // Tono medio
    osc.frequency.exponentialRampToValueAtTime(200, audioCtx.currentTime + 0.15); // Desciende suavemente

    // Control de volumen para evitar "clicks" bruscos
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.2, audioCtx.currentTime + 0.02); // Sube rápido a volumen bajo (0.2)
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2); // Se desvanece suavemente

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.25);
}

function playErrorSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.type = 'sine'; // Muy suave
    // Frecuencia baja, como un toque apagado
    osc.frequency.setValueAtTime(150, audioCtx.currentTime); 
    osc.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 0.15);

    // Volumen bajo y rápido
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime + 0.01); 
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
}

// --- ELEMENTOS UI ---
const panelLobby = document.getElementById('lobby');
const panelGame = document.getElementById('game-ui');
const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');
const inputRoom = document.getElementById('room-code');
const msgLobby = document.getElementById('lobby-msg');
const btnLeave = document.getElementById('btn-leave');
const btnRestart = document.getElementById('btn-restart');

const displayRoom = document.getElementById('room-display');
const displayTurn = document.getElementById('turn-display');
const displaySymbol = document.getElementById('my-symbol-display');
const coordX = document.getElementById('coord-x');
const coordY = document.getElementById('coord-y');
const coordZ = document.getElementById('coord-z');
const gameMsg = document.getElementById('game-msg');

// --- CONEXIÓN WEBSOCKET ---
function connectWebSocket() {
    // Si estamos en HTTPS, usamos WSS, si no WS
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Nos conectamos a la ruta /ws del mismo servidor que nos sirve la página
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log("Conectado al servidor");
        msgLobby.innerText = "Conectado al servidor multijugador.";
        msgLobby.style.color = "green";
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.type === 'room_created' || data.type === 'room_joined') {
            currentRoom = data.room_id;
            mySymbol = data.symbol;
            
            displayRoom.innerText = `Sala: ${currentRoom}`;
            displaySymbol.innerText = `Tú eres: ${mySymbol === 'X' ? 'Rojo' : 'Azul'}`;
            
            panelLobby.classList.remove('active');
            panelGame.classList.remove('hidden');
            setTimeout(() => panelGame.classList.add('active'), 10);
            
            init3D();
        } 
        else if (data.type === 'error') {
            msgLobby.innerText = data.message;
        }
        else if (data.type === 'state_update') {
            gameBoard = data.board;
            currentTurn = data.turn;
            winner = data.winner;
            winningLine = data.winning_line;
            
            updateUI();
            update3D();
        }
    };

    ws.onclose = () => {
        console.log("Desconectado del servidor");
        msgLobby.innerText = "Desconectado. Reintentando...";
        msgLobby.style.color = "red";
        setTimeout(connectWebSocket, 3000); // Reconnect
    };
    
    ws.onerror = (error) => {
        console.error("WebSocket Error: ", error);
        msgLobby.innerText = "Error de conexión al servidor.";
        msgLobby.style.color = "red";
    };
}

// --- EVENTOS UI ---
btnCreate.addEventListener('click', () => {
    if(ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'create_room' }));
    } else {
        msgLobby.innerText = "Aún no hay conexión con el servidor.";
        msgLobby.style.color = "red";
    }
});

btnJoin.addEventListener('click', () => {
    const code = inputRoom.value.trim();
    if(code && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'join_room', room_id: code }));
    }
});

btnLeave.addEventListener('click', () => {
    location.reload(); // Manera más simple de reiniciar el estado
});

btnRestart.addEventListener('click', () => {
    if(ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'restart_game' }));
    }
});

function updateUI() {
    if (winner) {
        if (winner === mySymbol) {
            gameMsg.innerText = "¡HAS GANADO!";
            gameMsg.style.color = '#00c853';
        } else {
            gameMsg.innerText = "HA GANADO EL RIVAL";
            gameMsg.style.color = '#e60012';
        }
        btnRestart.classList.remove('hidden');
    } else {
        gameMsg.innerText = "";
        btnRestart.classList.add('hidden');
        if (currentTurn === mySymbol) {
            displayTurn.innerText = "Turno: ¡Tú turno!";
            displayTurn.className = "my-turn";
        } else {
            displayTurn.innerText = "Turno: Esperando al rival...";
            displayTurn.className = "";
        }
    }
}

// --- THREE.JS ---
let scene, camera, renderer, controls;
let raycaster, mouse;
let cellMeshes = []; // Guarda las referencias a las celdas visuales (vacías)
let pieceMeshes = []; // Guarda las piezas jugadas
const gridSize = 4;
const spacing = 1.6; // Más separado para poder hacer clic adentro
const offset = (gridSize * spacing) / 2 - (spacing / 2);

// Materiales Switch style (Minimalista, colores sólidos no neón)
const matEmpty = new THREE.MeshStandardMaterial({ 
    color: 0xcccccc, 
    transparent: true, 
    opacity: 0.1,
    roughness: 0.8
});
const matHover = new THREE.MeshStandardMaterial({ 
    color: 0x888888, 
    transparent: true, 
    opacity: 0.5 
});
const matX = new THREE.MeshStandardMaterial({ 
    color: 0xe60012, // Rojo Nintendo
    roughness: 0.3,
    metalness: 0.1
});
const matO = new THREE.MeshStandardMaterial({ 
    color: 0x0078d7, // Azul
    roughness: 0.3,
    metalness: 0.1
});
const matWin = new THREE.MeshStandardMaterial({ 
    color: 0xffd700, // Dorado
    emissive: 0xaa8800,
    emissiveIntensity: 0.5,
    roughness: 0.2
});

const cubeGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7); // Celda de hover (Hitbox) un poco más pequeña que el espacio
const innerCubeGeo = new THREE.BoxGeometry(0.75, 0.75, 0.75); // Pieza real

function init3D() {
    if (scene) return; // Evitar reinicializar
    
    const canvas = document.getElementById('game-canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    scene = new THREE.Scene();
    
    // Luces suaves
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(8, 8, 12);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    createGrid();

    window.addEventListener('resize', onWindowResize);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('click', onClick);

    animate();
}

function createGrid() {
    // Crear celdas interactivas invisibles/transparentes
    for (let z = 0; z < gridSize; z++) {
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                const mesh = new THREE.Mesh(cubeGeo, matEmpty.clone());
                mesh.position.set(
                    x * spacing - offset,
                    y * spacing - offset,
                    z * spacing - offset
                );
                mesh.userData = { x, y, z, isCell: true };
                scene.add(mesh);
                cellMeshes.push(mesh);
            }
        }
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

let hoveredCell = null;

function onMouseMove(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    if (winner) return;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(cellMeshes);

    if (hoveredCell) {
        hoveredCell.material = matEmpty;
        hoveredCell = null;
    }

    if (intersects.length > 0) {
        const cell = intersects[0].object;
        // Solo hover si está vacía
        const { x, y, z } = cell.userData;
        if (gameBoard.length > 0 && gameBoard[z][y][x] === 0) {
            hoveredCell = cell;
            hoveredCell.material = matHover;
            
            // Actualizar HUD
            coordX.innerText = `X: ${x}`;
            coordY.innerText = `Y: ${y}`;
            coordZ.innerText = `Z: ${z}`;
        }
    } else {
        coordX.innerText = `X: -`;
        coordY.innerText = `Y: -`;
        coordZ.innerText = `Z: -`;
    }
}

function onClick(event) {
    if (winner) return;

    if (currentTurn !== mySymbol) {
        // Verificar si hizo clic dentro del área de juego
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects([...cellMeshes, ...pieceMeshes]);
        if (intersects.length > 0) {
            playErrorSound();
        }
        return;
    }

    if (!hoveredCell) return;
    
    const { x, y, z } = hoveredCell.userData;
    
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            action: 'make_move',
            x: x, y: y, z: z
        }));
    }
}

function update3D() {
    // Limpiar piezas anteriores
    pieceMeshes.forEach(p => scene.remove(p));
    pieceMeshes = [];

    if(!gameBoard || gameBoard.length === 0) return;

    let currentPieceCount = 0;

    for (let z = 0; z < gridSize; z++) {
        for (let y = 0; y < gridSize; y++) {
            for (let x = 0; x < gridSize; x++) {
                const val = gameBoard[z][y][x];
                if (val !== 0) {
                    currentPieceCount++;
                    let isWinningPiece = false;
                    if (winningLine) {
                        isWinningPiece = winningLine.some(p => p.x === x && p.y === y && p.z === z);
                    }
                    
                    let material;
                    if (isWinningPiece) {
                        material = matWin;
                    } else if (val === -1) { // 'X'
                        material = matX;
                    } else { // 'O'
                        material = matO;
                    }

                    // Usar un cubo un poco más grande que la celda transparente para que se vea bien sólido
                    const mesh = new THREE.Mesh(innerCubeGeo, material);
                    mesh.position.set(
                        x * spacing - offset,
                        y * spacing - offset,
                        z * spacing - offset
                    );
                    
                    // Pequeña animación de entrada si no es victoria
                    if(!winner) {
                        mesh.scale.set(0.1, 0.1, 0.1);
                        mesh.userData = { targetScale: 1.0 };
                    }
                    
                    scene.add(mesh);
                    pieceMeshes.push(mesh);
                    
                    // Ocultar la celda transparente base para que no haya z-fighting
                    const cell = cellMeshes.find(c => c.userData.x === x && c.userData.y === y && c.userData.z === z);
                    if(cell) cell.visible = false;
                } else {
                    const cell = cellMeshes.find(c => c.userData.x === x && c.userData.y === y && c.userData.z === z);
                    if(cell) cell.visible = true;
                }
            }
        }
    }
    
    // Reproducir sonido si hay piezas nuevas y no es una partida reiniciada
    if (currentPieceCount > lastPieceCount && lastPieceCount !== 0) {
        playSoftSound();
    } else if (currentPieceCount === 1) {
        // Sonido en la primera jugada
        playSoftSound();
    }
    lastPieceCount = currentPieceCount;
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    
    // Animar crecimiento de piezas nuevas
    pieceMeshes.forEach(mesh => {
        if(mesh.userData.targetScale) {
            mesh.scale.x += (mesh.userData.targetScale - mesh.scale.x) * 0.1;
            mesh.scale.y += (mesh.userData.targetScale - mesh.scale.y) * 0.1;
            mesh.scale.z += (mesh.userData.targetScale - mesh.scale.z) * 0.1;
        }
    });
    
    // Si hay victoria, animar rotación de las piezas ganadoras o un leve salto
    if (winner && pieceMeshes.length > 0) {
        const time = Date.now() * 0.005;
        pieceMeshes.forEach(mesh => {
            if(mesh.material === matWin) {
                mesh.position.y += Math.sin(time + mesh.position.x) * 0.005;
            }
        });
    }

    renderer.render(scene, camera);
}

// Iniciar app
connectWebSocket();
