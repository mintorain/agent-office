import Phaser from 'phaser';
import * as Colyseus from 'colyseus.js';
import { OfficeState, AgentState } from './schema';
import { eventBus } from '../events';

let activeRoom: Colyseus.Room<OfficeState> | undefined;

export function getColyseusRoom() {
    return activeRoom;
}

function resolveWsEndpoint(): string {
    if (typeof window !== 'undefined') {
        const queryWs = new URLSearchParams(window.location.search).get('ws');
        if (queryWs && queryWs.trim()) {
            window.localStorage.setItem('agent-office:ws-url', queryWs.trim());
            return queryWs.trim();
        }
        const savedWs = window.localStorage.getItem('agent-office:ws-url');
        if (savedWs && savedWs.trim()) return savedWs.trim();
    }
    const globalEndpoint = typeof window !== 'undefined'
        ? (window as any).__AGENT_OFFICE_WS_URL as string | undefined
        : undefined;
    if (globalEndpoint && globalEndpoint.trim()) return globalEndpoint.trim();
    if (typeof window !== 'undefined') {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${protocol}//${window.location.hostname}:3000`;
    }
    return 'ws://localhost:3000';
}

export class OfficeScene extends Phaser.Scene {
    private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    private room?: Colyseus.Room;
    private agentSprites: Map<string, Phaser.GameObjects.Container> = new Map();
    private statusText!: Phaser.GameObjects.Text;
    private followTarget: Phaser.GameObjects.Container | null = null;
    private cinematicMode = true;
    private cinematicReleaseAt = 0;
    private customLayoutLayer?: Phaser.GameObjects.Container;
    private layoutItems: Array<{ id: string; type: string; x: number; y: number; label?: string }> = [];
    private layoutEditMode = false;
    private layoutDragItemId: string | null = null;
    private gridSize = 40 * 16;
    private heldMoveKeys: Set<'left' | 'right' | 'up' | 'down'> = new Set();

    constructor() {
        super('OfficeScene');
    }

    preload() {
        this.load.spritesheet('char_0', '/assets/characters/char_0.png', {
            frameWidth: 16,
            frameHeight: 32
        });
        this.load.spritesheet('char_1', '/assets/characters/char_1.png', {
            frameWidth: 16,
            frameHeight: 32
        });
    }

    create() {
        try {
            console.log("Phaser create() started");
            this.statusText = this.add.text(10, 10, 'Colyseus Sync: Connecting...', { color: '#ffffaa', fontSize: '14px' });
            this.statusText.setScrollFactor(0);
            this.statusText.setDepth(100);

            let hasAnims = false;

            // Create animations for character 0
            if (this.textures.exists('char_0')) {
                const anims = this.anims;
                anims.create({ key: 'char_0-walk-down', frames: anims.generateFrameNumbers('char_0', { start: 0, end: 2 }), frameRate: 8, repeat: -1 });
                anims.create({ key: 'char_0-walk-up', frames: anims.generateFrameNumbers('char_0', { start: 7, end: 9 }), frameRate: 8, repeat: -1 });
                anims.create({ key: 'char_0-walk-right', frames: anims.generateFrameNumbers('char_0', { start: 14, end: 16 }), frameRate: 8, repeat: -1 });
                hasAnims = true;
            }
            // Create animations for character 1
            if (this.textures.exists('char_1')) {
                const anims = this.anims;
                anims.create({ key: 'char_1-walk-down', frames: anims.generateFrameNumbers('char_1', { start: 0, end: 2 }), frameRate: 8, repeat: -1 });
                anims.create({ key: 'char_1-walk-up', frames: anims.generateFrameNumbers('char_1', { start: 7, end: 9 }), frameRate: 8, repeat: -1 });
                anims.create({ key: 'char_1-walk-right', frames: anims.generateFrameNumbers('char_1', { start: 14, end: 16 }), frameRate: 8, repeat: -1 });
            }

            console.log("Animations created: ", hasAnims);

            const gridSize = this.gridSize;
            const g = this.add.graphics();

            // ═══════════════════════════════════════════
            //  FLOORING
            // ═══════════════════════════════════════════

            // Main office floor (warm grey carpet)
            g.fillStyle(0x2d2d3d, 1);
            g.fillRect(0, 0, gridSize, gridSize);

            // Work area floor (slightly lighter)
            g.fillStyle(0x33334a, 1);
            g.fillRect(16, 16, gridSize - 32, gridSize - 32);

            // Meeting room carpet (purple-tinted)
            g.fillStyle(0x352a45, 1);
            g.fillRect(32, 32, 200, 160);

            // Collab area carpet (warm orange-tinted)
            g.fillStyle(0x3d3025, 1);
            g.fillRect(280, 32, 200, 160);

            // Coffee area tiles (subtle checkerboard)
            for (let tx = 0; tx < 11; tx++) {
                for (let ty = 0; ty < 11; ty++) {
                    g.fillStyle((tx + ty) % 2 === 0 ? 0x2a3a2a : 0x253025, 1);
                    g.fillRect(350 + tx * 16, 350 + ty * 16, 16, 16);
                }
            }

            // ═══════════════════════════════════════════
            //  WALLS & PARTITIONS
            // ═══════════════════════════════════════════

            // Meeting room walls
            g.lineStyle(3, 0x6c5ce7, 0.9);
            g.strokeRect(32, 32, 200, 160);
            // Door gap (bottom-right of meeting room)
            g.fillStyle(0x33334a, 1);
            g.fillRect(192, 188, 40, 6);

            // Collab area walls
            g.lineStyle(3, 0xe17055, 0.9);
            g.strokeRect(280, 32, 200, 160);
            // Door gap
            g.fillStyle(0x33334a, 1);
            g.fillRect(280, 160, 40, 6);

            // Coffee area border
            g.lineStyle(2, 0x00b894, 0.7);
            g.strokeRect(350, 350, 176, 176);
            // Door gap
            g.fillStyle(0x33334a, 1);
            g.fillRect(350, 410, 4, 40);

            // Room labels
            this.add.text(132, 46, '🏢 Meeting Room', { fontSize: '10px', color: '#b8a9d4' }).setOrigin(0.5);
            this.add.text(380, 46, '💡 Collab Area', { fontSize: '10px', color: '#e8a87c' }).setOrigin(0.5);
            this.add.text(438, 364, '☕ Coffee & Pantry', { fontSize: '10px', color: '#7fcdaa' }).setOrigin(0.5);

            // (정적 가구 드로잉 로직이 동적 레이아웃과의 중복 및 꼬임 해결을 위해 전면 삭제되었습니다.)

            // ═══════════════════════════════════════════
            //  SUBTLE GRID (very faint)
            // ═══════════════════════════════════════════
            g.lineStyle(1, 0x444466, 0.12);
            g.beginPath();
            for (let i = 0; i <= gridSize; i += 16) {
                g.moveTo(i, 0).lineTo(i, gridSize);
                g.moveTo(0, i).lineTo(gridSize, i);
            }
            g.strokePath();

            this.cameras.main.setBackgroundColor('#16213e');
            this.cameras.main.setZoom(2);
            this.cameras.main.centerOn(gridSize / 2, gridSize / 2);
            this.cameras.main.setBounds(0, 0, gridSize, gridSize);
            this.customLayoutLayer = this.add.container(0, 0);
            this.customLayoutLayer.setDepth(4);

            if (this.input.keyboard) {
                this.cursors = this.input.keyboard.createCursorKeys();
            }

            eventBus.addEventListener('cinematic-toggle', (e: Event) => {
                const detail = (e as CustomEvent).detail as { enabled: boolean };
                this.cinematicMode = Boolean(detail?.enabled);
                if (!this.cinematicMode) {
                    this.cinematicReleaseAt = 0;
                }
            });
            eventBus.addEventListener('layout-preview-update', (e: Event) => {
                const detail = (e as CustomEvent).detail as { items: Array<{ id: string; type: string; x: number; y: number; label?: string }> };
                this.layoutItems = Array.isArray(detail?.items) ? detail.items : [];
                this.renderCustomLayout(this.layoutItems);
            });
            eventBus.addEventListener('layout-edit-mode', (e: Event) => {
                const detail = (e as CustomEvent).detail as { enabled: boolean };
                this.layoutEditMode = Boolean(detail?.enabled);
                if (!this.layoutEditMode) this.layoutDragItemId = null;
                
                // 가구 라벨 표시 제어 (편집 시에만 이름 표시)
                if (this.customLayoutLayer) {
                    this.customLayoutLayer.iterate((group: any) => {
                        if (group instanceof Phaser.GameObjects.Container) {
                            const label = group.getByName('furniture-label') as Phaser.GameObjects.Text;
                            if (label) {
                                label.setVisible(this.layoutEditMode);
                            }
                        }
                    });
                }
            });

            this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
                if (!this.layoutEditMode || !this.layoutDragItemId || !pointer.isDown) return;
                
                // 16px 그리드 연산 없이, 마우스 월드 좌표로 부드럽게 직접 픽셀 이동
                if (this.customLayoutLayer) {
                    this.customLayoutLayer.iterate((child: any) => {
                        if (child instanceof Phaser.GameObjects.Container && child.getData('id') === this.layoutDragItemId) {
                            child.x = pointer.worldX;
                            child.y = pointer.worldY;
                            child.setAlpha(0.65); // 드래그 중 반투명 피드백 유지
                        }
                    });
                }
            });
            this.input.on('pointerup', () => {
                if (!this.layoutEditMode || !this.layoutDragItemId) return;

                let snapX = 0;
                let snapY = 0;

                // 마우스를 뗀 시점에 16px 그리드로 자석 스냅 정렬
                if (this.customLayoutLayer) {
                    this.customLayoutLayer.iterate((child: any) => {
                        if (child instanceof Phaser.GameObjects.Container && child.getData('id') === this.layoutDragItemId) {
                            const gx = Phaser.Math.Clamp(Math.round(child.x / 16), 2, 36);
                            const gy = Phaser.Math.Clamp(Math.round(child.y / 16), 2, 36);
                            
                            child.x = gx * 16;
                            child.y = gy * 16;
                            child.setAlpha(1.0); // 투명도 원복
                            
                            snapX = gx;
                            snapY = gy;
                        }
                    });
                }

                if (snapX > 0 && snapY > 0) {
                    this.layoutItems = this.layoutItems.map((item) =>
                        item.id === this.layoutDragItemId ? { ...item, x: snapX, y: snapY } : item
                    );
                    
                    // 리액트 상태 동기화 및 DB 저장을 위한 디스패치
                    eventBus.dispatchEvent(new CustomEvent('layout-item-moved', { detail: { items: this.layoutItems } }));
                    
                    // 자석 스냅이 적용된 최종 좌표로 가구 재배치 렌더링
                    this.renderCustomLayout(this.layoutItems);
                }

                this.layoutDragItemId = null;
            });
            this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _objects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) => {
                const nextZoom = Phaser.Math.Clamp(this.cameras.main.zoom - deltaY * 0.001, 1, 3);
                this.cameras.main.setZoom(nextZoom);
            });

            const toMoveDirection = (event: KeyboardEvent): 'left' | 'right' | 'up' | 'down' | null => {
                const key = (event.key || '').toLowerCase();
                const code = (event.code || '').toLowerCase();
                if (key === 'arrowleft' || key === 'a' || code === 'arrowleft' || code === 'keya') return 'left';
                if (key === 'arrowright' || key === 'd' || code === 'arrowright' || code === 'keyd') return 'right';
                if (key === 'arrowup' || key === 'w' || code === 'arrowup' || code === 'keyw') return 'up';
                if (key === 'arrowdown' || key === 's' || code === 'arrowdown' || code === 'keys') return 'down';
                return null;
            };

            const keyDownHandler = (event: KeyboardEvent) => {
                const dir = toMoveDirection(event);
                if (!dir) return;
                const active = document.activeElement as HTMLElement | null;
                const isEditable = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA' || active?.isContentEditable;
                if (isEditable) return;
                this.heldMoveKeys.add(dir);
                event.preventDefault();
            };
            const keyUpHandler = (event: KeyboardEvent) => {
                const dir = toMoveDirection(event);
                if (!dir) return;
                this.heldMoveKeys.delete(dir);
            };
            window.addEventListener('keydown', keyDownHandler, { capture: true });
            window.addEventListener('keyup', keyUpHandler, { capture: true });
            document.addEventListener('keydown', keyDownHandler, { capture: true });
            document.addEventListener('keyup', keyUpHandler, { capture: true });
            window.addEventListener('blur', () => this.heldMoveKeys.clear());
            this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
                window.removeEventListener('keydown', keyDownHandler, true);
                window.removeEventListener('keyup', keyUpHandler, true);
                document.removeEventListener('keydown', keyDownHandler, true);
                document.removeEventListener('keyup', keyUpHandler, true);
                this.heldMoveKeys.clear();
            });

            this.connectToServer();
        } catch (e) {
            console.error("CRITICAL PHASER ERROR", e);
        }
    }

    async connectToServer() {
        try {
            console.log("Connecting to Colyseus...");
            const wsEndpoint = resolveWsEndpoint();
            this.statusText.setText(`Colyseus Sync: Connecting to ${wsEndpoint}...`).setColor('#ffffaa');
            const client = new Colyseus.Client(wsEndpoint);
            this.room = await client.joinOrCreate('office');

            console.log("Room joined successfully!", this.room.sessionId);
            this.statusText.setText('Colyseus Sync: Connected (Waiting for state...)').setColor('#aaffaa');

            // Wait for the first actual state payload from the server before reading
            this.room.onStateChange.once((state: any) => {
                activeRoom = this.room as Colyseus.Room<OfficeState>;
                console.log("First state payload arrived!", state.toJSON());
                console.log("Agents map size:", state.agents?.size);
                this.statusText.setText('Colyseus Sync: Active!').setColor('#00ff00');

                // Bind chat bus
                this.room!.onMessage('chat', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('chat-message', { detail: message }));
                });
                this.room!.onMessage('highlight-event', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('highlight-event', { detail: message }));
                    if (this.cinematicMode && message?.agentId) {
                        this.focusAgentTemporarily(message.agentId);
                    }
                });
                this.room!.onMessage('scenario-event', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('scenario-event', { detail: message }));
                });
                this.room!.onMessage('relationship-update', (message: any) => {
                    eventBus.dispatchEvent(new CustomEvent('relationship-update', { detail: message }));
                });
                this.room!.onMessage('layout-sync', (message: any) => {
                    this.layoutItems = Array.isArray(message?.layout) ? message.layout : [];
                    this.renderCustomLayout(this.layoutItems);
                    eventBus.dispatchEvent(new CustomEvent('layout-sync', { detail: { items: this.layoutItems } }));
                });

                state.agents.onAdd((agent: AgentState, sessionId: string) => {
                    console.log(`[Colyseus] Agent added: ${agent.name} at (${agent.x}, ${agent.y})`);
                    const container = this.add.container(agent.x * 16, agent.y * 16);

                    let sprite;
                    let charKey = 'char_0';
                    if (agent.name.includes('Bob')) charKey = 'char_1';

                    if (this.textures.exists(charKey)) {
                        sprite = this.add.sprite(0, -8, charKey, 0);
                    } else {
                        sprite = this.add.rectangle(0, -8, 16, 32, 0x3a86ff);
                    }

                    // Thought bubble (word-wrapped)
                    const thoughtBubble = this.add.text(0, -36, '', {
                        fontSize: '9px',
                        color: '#e0e0e0',
                        backgroundColor: '#1a1a3eee',
                        padding: { x: 5, y: 4 },
                        align: 'center',
                        wordWrap: { width: 130, useAdvancedWrap: true }
                    }).setOrigin(0.5, 1);
                    thoughtBubble.setVisible(false);

                    // Emote bubble (emoji above head)
                    const emoteBubble = this.add.text(8, -24, '', {
                        fontSize: '12px'
                    }).setOrigin(0.5);
                    emoteBubble.setVisible(false);

                    // Name label
                    const label = this.add.text(0, 16, agent.name, {
                        fontSize: '10px', color: '#ffffff',
                        backgroundColor: '#00000088', padding: { x: 2, y: 1 }
                    }).setOrigin(0.5, 0);

                    // Focus highlight ring (hidden by default)
                    const focusRing = this.add.graphics();
                    focusRing.lineStyle(1, 0x6c5ce7, 0.8);
                    focusRing.strokeCircle(0, 0, 14);
                    focusRing.setVisible(false);

                    container.add([focusRing, sprite, thoughtBubble, emoteBubble, label]);
                    container.setSize(32, 48);
                    container.setInteractive();
                    container.setDepth(6); // 가구 레이어(Depth 4)보다 위에 배치하여 사람 가려짐 현상 해결
                    this.agentSprites.set(sessionId, container);

                    // --- FOCUS MODE: Click to follow ---
                    container.on('pointerdown', () => {
                        if (this.followTarget === container) {
                            // Unfollow on second click
                            this.followTarget = null;
                            focusRing.setVisible(false);
                            eventBus.dispatchEvent(new CustomEvent('agent-focus', { detail: null }));
                        } else {
                            // Unfollow previous
                            if (this.followTarget) {
                                const prevRing = this.followTarget.getAt(0) as Phaser.GameObjects.Graphics;
                                prevRing?.setVisible(false);
                            }
                            this.followTarget = container;
                            focusRing.setVisible(true);
                            eventBus.dispatchEvent(new CustomEvent('agent-focus', { detail: { name: agent.name, id: sessionId } }));
                        }
                    });

                    let prevX = agent.x;
                    let prevY = agent.y;
                    let lastAction = '';

                    agent.onChange(() => {
                        this.tweens.add({
                            targets: container,
                            x: agent.x * 16,
                            y: agent.y * 16,
                            duration: 100,
                            onComplete: () => {
                                if (sprite.type === 'Sprite') {
                                    (sprite as Phaser.GameObjects.Sprite).stop();
                                }
                            }
                        });

                        // Walk animation
                        if (sprite.type === 'Sprite') {
                            const s = sprite as Phaser.GameObjects.Sprite;
                            if (agent.x > prevX) { s.play(`${charKey}-walk-right`, true); s.setFlipX(false); }
                            else if (agent.x < prevX) { s.play(`${charKey}-walk-right`, true); s.setFlipX(true); }
                            else if (agent.y > prevY) { s.play(`${charKey}-walk-down`, true); }
                            else if (agent.y < prevY) { s.play(`${charKey}-walk-up`, true); }
                            else { s.stop(); }
                        }

                        // --- EMOTE BUBBLES based on action ---
                        const emoteMap: Record<string, string> = {
                            'work': '💻', 'talk': '💬', 'idle': '😌',
                            'use_tool': '🔧', 'move': '🚶', 'think': '💡'
                        };
                        const emote = emoteMap[agent.action] || '';
                        if (emote && agent.action !== lastAction) {
                            emoteBubble.setText(emote);
                            emoteBubble.setVisible(true);
                            // Auto-hide after 3s
                            this.time.delayedCall(3000, () => emoteBubble.setVisible(false));
                        }

                        // Thought bubble
                        if (agent.thought && agent.thought !== '') {
                            thoughtBubble.setText(agent.thought);
                            thoughtBubble.setVisible(true);
                            this.time.delayedCall(6000, () => thoughtBubble.setVisible(false));
                        }

                        // --- SYSTEM LOG EVENT ---
                        if (agent.action !== lastAction || agent.thought !== '') {
                            eventBus.dispatchEvent(new CustomEvent('activity-log', {
                                detail: {
                                    agent: agent.name,
                                    action: agent.action,
                                    thought: agent.thought,
                                    time: new Date().toLocaleTimeString()
                                }
                            }));
                        }
                        eventBus.dispatchEvent(new CustomEvent('agent-telemetry', {
                            detail: {
                                id: sessionId,
                                name: agent.name,
                                mood: Number(agent.mood || 0),
                                reputation: Number(agent.reputation || 0),
                                riskLevel: Number(agent.riskLevel || 0),
                                momentum: Number(agent.momentum || 0),
                                action: agent.action
                            }
                        }));

                        lastAction = agent.action;
                        prevX = agent.x;
                        prevY = agent.y;
                    });
                });

                state.agents.onRemove((agent: AgentState, sessionId: string) => {
                    const sprite = this.agentSprites.get(sessionId);
                    if (sprite) {
                        sprite.destroy();
                        this.agentSprites.delete(sessionId);
                    }
                });
            });

        } catch (e) {
            console.error(e);
            const wsEndpoint = resolveWsEndpoint();
            this.statusText.setText(`Colyseus Sync: Failed (${wsEndpoint})`).setColor('#ffaaaa');
        }
    }

    update() {
        if (this.cinematicReleaseAt > 0 && Date.now() > this.cinematicReleaseAt) {
            this.cinematicReleaseAt = 0;
            this.followTarget = null;
        }
        const speed = 5;
        const manualPan =
            this.heldMoveKeys.size > 0 ||
            Boolean(this.cursors?.left.isDown) ||
            Boolean(this.cursors?.right.isDown) ||
            Boolean(this.cursors?.up.isDown) ||
            Boolean(this.cursors?.down.isDown);
        if (manualPan) {
            // User input should always win over cinematic follow.
            this.followTarget = null;
            this.cinematicReleaseAt = 0;
            if (this.cursors?.left.isDown || this.heldMoveKeys.has('left')) this.cameras.main.scrollX -= speed;
            if (this.cursors?.right.isDown || this.heldMoveKeys.has('right')) this.cameras.main.scrollX += speed;
            if (this.cursors?.up.isDown || this.heldMoveKeys.has('up')) this.cameras.main.scrollY -= speed;
            if (this.cursors?.down.isDown || this.heldMoveKeys.has('down')) this.cameras.main.scrollY += speed;
        }
        // If following an agent, smoothly track them
        if (this.followTarget && !manualPan) {
            const cam = this.cameras.main;
            const targetX = this.followTarget.x - cam.width / (2 * cam.zoom);
            const targetY = this.followTarget.y - cam.height / (2 * cam.zoom);
            cam.scrollX += (targetX - cam.scrollX) * 0.08;
            cam.scrollY += (targetY - cam.scrollY) * 0.08;
        }
        const cam = this.cameras.main;
        const maxScrollX = Math.max(0, this.gridSize - cam.width / cam.zoom);
        const maxScrollY = Math.max(0, this.gridSize - cam.height / cam.zoom);
        cam.scrollX = Phaser.Math.Clamp(cam.scrollX, 0, maxScrollX);
        cam.scrollY = Phaser.Math.Clamp(cam.scrollY, 0, maxScrollY);
    }

    private focusAgentTemporarily(agentId: string) {
        const target = this.agentSprites.get(agentId);
        if (!target) return;
        this.followTarget = target;
        this.cinematicReleaseAt = Date.now() + 7000;
    }

    private renderCustomLayout(items: Array<{ type: string; x: number; y: number; label?: string }>) {
        if (!this.customLayoutLayer) return;
        this.customLayoutLayer.removeAll(true);
        for (let index = 0; index < items.length; index++) {
            const source = items[index] as { id?: string; type: string; x: number; y: number; label?: string };
            const item = {
                ...source,
                id: source.id || `layout_${index}`
            };
            const x = Math.round(item.x) * 16;
            const y = Math.round(item.y) * 16;
            const group = this.add.container(x, y);
            const g = this.add.graphics();

            // 1. 공통 반투명 가구 그림자 (입체감 유도)
            g.fillStyle(0x000000, 0.3);
            g.fillCircle(1, 3, 7);

            switch (item.type) {
                case 'plant':
                    // 고급스러운 대리석/황동 화분 묘사 (사다리꼴)
                    g.fillStyle(0x8a97a8, 1); // 실버 대리석
                    g.fillRect(-5, 0, 10, 8);
                    g.fillStyle(0xffd700, 1); // 황동 포인트 밴드
                    g.fillRect(-5, 2, 10, 2);
                    
                    // 몬스테라 관엽식물 스타일 잎맥 디테일
                    g.fillStyle(0x1b4d3e, 1); // 짙은 초록
                    g.fillCircle(0, -6, 6);
                    g.fillStyle(0x2d7a5f, 1); // 밝은 녹색 잎사귀 겹침
                    g.fillCircle(-4, -8, 4);
                    g.fillCircle(4, -7, 4);
                    g.fillStyle(0x52b788, 1); // 잎사귀 끝 하이라이트
                    g.fillCircle(1, -9, 3);
                    break;
                case 'desk':
                    // 고급 원목 상판
                    g.fillStyle(0x4a2c11, 1); // 로즈우드 본체
                    g.fillRect(-14, -8, 28, 16);
                    g.fillStyle(0x6e4726, 1); // 베벨 하이라이트 상판
                    g.fillRect(-12, -6, 24, 12);
                    
                    // 데스크 미니어처 묘사 (고급 듀얼 모니터 & 키보드)
                    g.fillStyle(0x1a1a2e, 1); // 검정 듀얼 와이드 모니터
                    g.fillRect(-10, -4, 20, 2);
                    g.fillStyle(0xdcdde1, 1); // 은색 키보드
                    g.fillRect(-4, 2, 8, 2);
                    g.fillStyle(0x00a8ff, 1); // 스마트 워크 램프
                    g.fillRect(8, -2, 2, 2);
                    break;
                case 'bookshelf':
                    // 고급 3단 월넛 서재 책장
                    g.fillStyle(0x3e2723, 1);
                    g.fillRect(-8, -12, 16, 24);
                    g.fillStyle(0x4e342e, 1); // 선반 테두리 입체
                    g.strokeRect(-8, -12, 16, 24);
                    
                    // 다채롭고 높낮이가 무작위인 고급 서적 연출
                    const bookColors = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0x9b59b6, 0xe67e22, 0x1abc9c];
                    // 1단 서적
                    for (let b = 0; b < 3; b++) {
                        g.fillStyle(bookColors[(b + index) % bookColors.length], 1);
                        g.fillRect(-6 + b * 4, -9, 3, 7);
                    }
                    // 2단 서적 (약간 비스듬히 기울어짐 표현)
                    g.fillStyle(bookColors[(1 + index) % bookColors.length], 1);
                    g.fillRect(-6, -1, 3, 7);
                    g.fillStyle(bookColors[(3 + index) % bookColors.length], 1);
                    g.fillRect(-2, -1, 3, 7);
                    g.fillStyle(bookColors[(5 + index) % bookColors.length], 1);
                    // 비스듬히 눕혀진 책 픽셀
                    g.fillRect(2, 1, 4, 5);

                    // 3단 서적
                    for (let b = 0; b < 3; b++) {
                        g.fillStyle(bookColors[(b + index + 2) % bookColors.length], 1);
                        g.fillRect(-6 + b * 4, 7, 3, 4);
                    }
                    break;
                case 'coffee_machine':
                    // 크롬 에스프레소 머신 디자인
                    g.fillStyle(0xb2bec3, 1); // 크롬 바디
                    g.fillRect(-6, -8, 12, 16);
                    g.fillStyle(0xdfe6e9, 1); // 전면 메탈 플레이트
                    g.fillRect(-4, -6, 8, 12);
                    g.fillStyle(0x2d3436, 1); // 추출구 및 디스플레이 패널
                    g.fillRect(-3, -4, 6, 4);
                    g.fillStyle(0x00b894, 1); // 커피 추출 활성화 녹색 LED
                    g.fillCircle(0, 4, 1.5);
                    break;
                case 'table':
                    // 라운드 코너 베이지 대리석 회의 테이블
                    g.fillStyle(0xdcdde1, 1); // 회색 하단 프레임
                    g.fillRect(-11, -7, 22, 14);
                    g.fillStyle(0xf5f6fa, 1); // 대리석 상판
                    g.fillRect(-10, -6, 20, 12);
                    // 가벼운 대리석 마블 패턴 드로잉
                    g.lineStyle(1, 0xd2dae2, 0.8);
                    g.beginPath();
                    g.moveTo(-6, -2);
                    g.lineTo(2, 4);
                    g.moveTo(4, -4);
                    g.lineTo(-2, 2);
                    g.strokePath();
                    break;
                case 'chair':
                    // U자형 메쉬 등받이 및 팔걸이가 있는 고급 오피스 의자
                    g.lineStyle(1.5, 0x2f3640, 1); // 튼튼한 프레임
                    g.strokeCircle(0, 0, 7);
                    
                    g.fillStyle(0x2f3640, 1); // 시크한 챠콜 메쉬 백레스트
                    g.fillCircle(0, -2, 5);
                    g.fillStyle(0x706fd3, 1); // 프리미엄 딥블루 의자 시트
                    g.fillCircle(0, 1, 4.5);
                    
                    // 의자 바퀴 다리 실루엣 (크롬 포인트)
                    g.fillStyle(0x7f8c8d, 1);
                    g.fillRect(-1, 5, 2, 2);
                    break;
                case 'whiteboard':
                    // 알루미늄 다리 프레임이 있는 보드
                    g.fillStyle(0x718093, 1); // 메탈 다리 지지대
                    g.fillRect(-10, -6, 2, 16);
                    g.fillRect(8, -6, 2, 16);
                    
                    g.fillStyle(0xdcdde1, 1); // 외관 베젤 프레임
                    g.fillRect(-10, -6, 20, 12);
                    g.fillStyle(0xffffff, 1); // 화이트보드 면
                    g.fillRect(-9, -5, 18, 10);
                    
                    // 하단 컬러 펜 트레이
                    g.fillStyle(0xe74c3c, 1); // 레드 마커
                    g.fillRect(-4, 5, 2, 1);
                    g.fillStyle(0x2980b9, 1); // 블루 마커
                    g.fillRect(0, 5, 2, 1);
                    break;
                default:
                    g.fillStyle(0xb2bec3, 1);
                    g.fillRect(-6, -6, 12, 12);
            }
            group.add(g);
            if (item.label) {
                const label = this.add.text(0, 12, item.label.slice(0, 8), { fontSize: '8px', color: '#dfe6f3', fontStyle: 'bold' }).setOrigin(0.5, 0);
                label.setName('furniture-label');
                label.setVisible(this.layoutEditMode); // 배치 모드일 때만 보이도록 초기 가시성 지정
                group.add(label);
            }
            group.setSize(22, 22);
            group.setData('id', item.id);
            group.setInteractive(new Phaser.Geom.Rectangle(-11, -11, 22, 22), Phaser.Geom.Rectangle.Contains);
            group.on('pointerdown', () => {
                if (!this.layoutEditMode) return;
                this.layoutDragItemId = item.id;
                group.setAlpha(0.65);
            });
            this.customLayoutLayer.add(group);
        }
    }
}

export function setupPhaser(parentId: string) {
    const config: Phaser.Types.Core.GameConfig = {
        type: Phaser.AUTO,
        parent: parentId,
        width: window.innerWidth,
        height: window.innerHeight,
        scene: [OfficeScene],
        pixelArt: true,
        scale: {
            mode: Phaser.Scale.RESIZE,
        },
        input: {
            keyboard: {
                capture: [] // Don't capture ANY keys globally — let React inputs work
            }
        }
    };

    const game = new Phaser.Game(config);

    // When ANY input/textarea/select is focused, fully disable Phaser keyboard
    // When they blur, re-enable it
    document.addEventListener('focusin', (e) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            game.input.keyboard?.enabled && (game.input.keyboard.enabled = false);
        }
    });
    document.addEventListener('focusout', (e) => {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
            game.input.keyboard && (game.input.keyboard.enabled = true);
        }
    });

    return game;
}
