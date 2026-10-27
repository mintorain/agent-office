import { Room, Client } from 'colyseus';
import { OfficeState } from '../schema/OfficeState';
import { Agent, Office, OfficeConfig, ConversationMessage, InferenceAdapter } from '@agent-office/core';
import { OllamaAdapter, OpenAICompatibleAdapter } from '@agent-office/adapters';
import { ToolExecutor } from '../tools/ToolExecutor';
import { MemoryStore } from '../memory/MemoryStore';
import fs from 'fs';
import path from 'path';

interface HighlightEvent {
    type: string;
    title: string;
    body: string;
    agentId?: string | null;
    scenario: string;
    time: string;
}

interface RelationshipEdge {
    a: string;
    b: string;
    score: number;
    status: 'alliance' | 'neutral' | 'rivalry';
    updatedAt: string;
}

export class OfficeRoom extends Room<OfficeState> {
    private static activeRoom: OfficeRoom | null = null;

    maxClients = 100;
    private office!: Office;
    private demoTickCount = 0;
    private coreAgents: Map<string, Agent> = new Map();
    private thinkingLocks: Map<string, boolean> = new Map();
    private inferenceAdapter!: InferenceAdapter;
    private llmProvider!: 'ollama' | 'openai' | 'gaia' | 'anthropic' | 'custom';
    private llmModel!: string;
    private hireCount = 0; // Counter for generating unique IDs
    private toolExecutor = new ToolExecutor();
    private memoryStore = new MemoryStore();
    private sessionId = `session_${Date.now()}`;
    private currentScenario = 'Free Play';
    private highlights: HighlightEvent[] = [];
    private chaosHistory: Array<{ event: string; label: string; time: string }> = [];
    private relationships: Map<string, RelationshipEdge> = new Map();
    private audienceVotes: Record<string, number> = {};
    private currentLayout: any[] = [];

    // Furniture interaction points: named locations agents can walk to
    private furnitureTargets: Record<string, { x: number; y: number; type: string }> = {
        'jitae-desk': { x: 5, y: 13, type: 'desk' },
        'sinwu-desk': { x: 8, y: 13, type: 'desk' },
        'mina-desk': { x: 5, y: 19, type: 'desk' },
        'yujin-desk': { x: 8, y: 19, type: 'desk' },
        'meeting-table': { x: 18, y: 8, type: 'table' },
        'coffee-machine': { x: 30, y: 8, type: 'appliance' },
        'whiteboard': { x: 18, y: 4, type: 'board' },
        'bookshelf': { x: 34, y: 20, type: 'furniture' },
        'user_hire_0-desk': { x: 5, y: 25, type: 'desk' },
        'user_hire_1-desk': { x: 8, y: 25, type: 'desk' },
    };

    static getActiveRoom(): OfficeRoom | null {
        return OfficeRoom.activeRoom;
    }

    async onCreate(options: any) {
        OfficeRoom.activeRoom = this;
        this.setState(new OfficeState());

        // Initialize memory store
        await this.memoryStore.initialize();

        this.llmProvider = (process.env.LLM_PROVIDER || 'ollama') as 'ollama' | 'openai' | 'gaia' | 'anthropic' | 'custom';
        this.llmModel = process.env.LLM_MODEL || (this.llmProvider === 'openai' ? 'gpt-4o-mini' : 'llama3.2:latest');
        const apiKey = process.env.OPENAI_API_KEY || '';
        const apiBase = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
        const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

        if (this.llmProvider === 'openai' && apiKey) {
            console.log(`[OfficeRoom] Using OpenAICompatibleAdapter with model: ${this.llmModel}`);
            this.inferenceAdapter = new OpenAICompatibleAdapter(apiBase, apiKey, 'openai');
        } else {
            console.log(`[OfficeRoom] Using OllamaAdapter at ${ollamaBaseUrl} with model: ${this.llmModel}`);
            this.inferenceAdapter = new OllamaAdapter(ollamaBaseUrl);
        }

        const config: OfficeConfig = {
            name: options.name || '두온교육 사무실',
            grid: { width: 40, height: 40, tileSize: 16 },
            rooms: [],
            furniture: [],
            spawnPoints: [{ x: 10, y: 10 }],
            zones: []
        };
        this.office = new Office(config);

        // Setup Core Agents with AI capabilities
        const setupCoreAgent = async (agentData: any) => {
            const { id, name, role, x, y, llm } = agentData;
            this.state.createAgent(id, name);
            const state = this.state.agents.get(id);
            if (state) { state.x = x; state.y = y; }

            // Determine LLM adapters for this specific agent
            let agentAdapter: InferenceAdapter = this.inferenceAdapter;
            let agentProvider = this.llmProvider;
            let agentModel = this.llmModel;

            if (llm && llm.provider) {
                agentProvider = llm.provider as any;
                agentModel = llm.model || (llm.provider === 'openai' ? 'gpt-4o-mini' : 'llama3.2:latest');
                if (llm.provider === 'openai' && llm.apiBase) {
                    console.log(`[OfficeRoom] Agent [${name}] using custom OpenAI endpoint: ${llm.apiBase}`);
                    agentAdapter = new OpenAICompatibleAdapter(llm.apiBase, llm.apiKey || 'sk-dummy', 'openai');
                } else if (llm.provider === 'ollama' && llm.apiBase) {
                    console.log(`[OfficeRoom] Agent [${name}] using custom Ollama endpoint: ${llm.apiBase}`);
                    agentAdapter = new OllamaAdapter(llm.apiBase);
                }
            }

            const coreAgent = new Agent({
                id, name, role, avatar: 'sprite.png',
                inference: {
                    provider: agentProvider,
                    model: agentModel,
                    systemPrompt: `You are ${name}, a ${role} in a virtual office. Be social, do your work, and collaborate with colleagues. Keep thoughts SHORT.`,
                },
                personality: {
                    traits: { openness: 0.8, conscientiousness: 0.9, extraversion: 0.6, agreeableness: 0.7, neuroticism: 0.1 },
                    communicationStyle: role === 'Engineer' ? 'technical' : 'casual',
                    workHours: { start: '09:00', end: '17:00' },
                    breakFrequency: 120
                },
                capabilities: [
                    { name: 'code_execute', description: 'Execute JavaScript code' },
                    { name: 'web_search', description: 'Search the web for information' },
                    { name: 'write_note', description: 'Write a note or memo' },
                    { name: 'create_task', description: 'Create a task and assign it to yourself or another agent' },
                    { name: 'hire_agent', description: 'Hire a new team member (intern, developer, designer). Params: { name: string, role: string }' }
                ],
                memory: { shortTermLimit: 50 }
            });

            coreAgent.setInferenceAdapter(agentAdapter);
            await coreAgent.initialize();

            // Load persistent memories from previous sessions
            const previousMemories = await this.memoryStore.loadMemories(id, 20);
            if (previousMemories.length > 0) {
                coreAgent.loadMemories(previousMemories);
                console.log(`[${name}] Loaded ${previousMemories.length} memories from previous sessions`);
            }

            this.coreAgents.set(id, coreAgent);
            this.thinkingLocks.set(id, false);
        };

        // Load custom agents configuration from agents_config.json if available
        let agentsList: any[] = [];
        const configPath = path.resolve(process.cwd(), 'agents_config.json');
        if (fs.existsSync(configPath)) {
            try {
                const rawConfig = fs.readFileSync(configPath, 'utf8');
                agentsList = JSON.parse(rawConfig);
                console.log(`[OfficeRoom] Loaded ${agentsList.length} custom agents from configuration.`);
            } catch (err) {
                console.error(`[OfficeRoom] Failed to parse agents_config.json, falling back to default.`, err);
            }
        }

        if (agentsList.length === 0) {
            agentsList = [
                { id: 'jitae', name: '지태', role: 'PM', x: 4, y: 17 },
                { id: 'sinwu', name: '신우', role: '엔지니어', x: 7, y: 17 },
                { id: 'mina', name: '민아', role: '디자이너', x: 4, y: 23 },
                { id: 'yujin', name: '유진', role: '마케터', x: 7, y: 23 }
            ];
        }

        for (const agentData of agentsList) {
            await setupCoreAgent(agentData);
        }
        this.rebuildRelationshipGraph();
        const savedLayout = await this.memoryStore.loadLayout('default');
        // Force layout reset to overwrite existing DB presets with premium coordinates
        let needsReset = true;

        if (needsReset) {
            // Initialize a beautifully designed default layout for Douon Education Office
            this.currentLayout = [
                // 개인 업무 구역 (데스크 및 업무용 의자)
                // 1그룹 (지태 & 신우)
                { id: 'f_jitae_desk', type: 'desk', x: 5, y: 12, label: '지태 책상' },
                { id: 'f_jitae_chair', type: 'chair', x: 5, y: 13 },
                { id: 'f_sinwu_desk', type: 'desk', x: 8, y: 12, label: '신우 책상' },
                { id: 'f_sinwu_chair', type: 'chair', x: 8, y: 13 },

                // 2그룹 (민아 & 유진)
                { id: 'f_mina_desk', type: 'desk', x: 5, y: 18, label: '민아 책상' },
                { id: 'f_mina_chair', type: 'chair', x: 5, y: 19 },
                { id: 'f_yujin_desk', type: 'desk', x: 8, y: 18, label: '유진 책상' },
                { id: 'f_yujin_chair', type: 'chair', x: 8, y: 19 },

                // 3그룹 (공석 - 신규 직원 채용용)
                { id: 'f_vacant_desk1', type: 'desk', x: 5, y: 24, label: '팀원 책상 1' },
                { id: 'f_vacant_chair1', type: 'chair', x: 5, y: 25 },
                { id: 'f_vacant_desk2', type: 'desk', x: 8, y: 24, label: '팀원 책상 2' },
                { id: 'f_vacant_chair2', type: 'chair', x: 8, y: 25 },

                // 회의실 구역 (미팅 테이블 중심으로 동서남북 6개의 의자 대칭 정렬)
                { id: 'f_meeting_table', type: 'table', x: 18, y: 8, label: '중앙 회의 테이블' },
                { id: 'f_meeting_chair1', type: 'chair', x: 16, y: 8 },
                { id: 'f_meeting_chair2', type: 'chair', x: 16, y: 9 },
                { id: 'f_meeting_chair3', type: 'chair', x: 20, y: 8 },
                { id: 'f_meeting_chair4', type: 'chair', x: 20, y: 9 },
                { id: 'f_meeting_chair5', type: 'chair', x: 18, y: 6 },
                { id: 'f_meeting_chair6', type: 'chair', x: 18, y: 11 },
                { id: 'f_whiteboard', type: 'whiteboard', x: 18, y: 4, label: '아이디어 보드' },

                // 휴게소 및 탕비실 구역 (커피머신 및 티타임 테이블)
                { id: 'f_coffee', type: 'coffee_machine', x: 30, y: 8, label: '두온 카페테리아' },
                { id: 'f_lounge_table', type: 'table', x: 34, y: 8, label: '라운지 테이블' },
                { id: 'f_lounge_chair1', type: 'chair', x: 33, y: 8 },
                { id: 'f_lounge_chair2', type: 'chair', x: 35, y: 8 },

                // 도서/서고 구역 (책장)
                { id: 'f_bookshelf1', type: 'bookshelf', x: 34, y: 20, label: '기술/IT 서적 책장' },
                { id: 'f_bookshelf2', type: 'bookshelf', x: 34, y: 22, label: '경영/인문학 서적 책장' },

                // 조경 인테리어 (모퉁이 관엽식물 및 중앙 녹지 데코)
                { id: 'f_plant1', type: 'plant', x: 2, y: 2, label: '벤자민 고무나무' },
                { id: 'f_plant2', type: 'plant', x: 38, y: 2, label: '아레카 야자' },
                { id: 'f_plant3', type: 'plant', x: 2, y: 38, label: '금전수' },
                { id: 'f_plant4', type: 'plant', x: 38, y: 38, label: '몬스테라' },
                { id: 'f_plant5', type: 'plant', x: 18, y: 14, label: '중앙 오피스 화단' },
                { id: 'f_plant6', type: 'plant', x: 26, y: 8, label: '올리브 웰컴 나무' }
            ];
            await this.memoryStore.saveLayout('default', JSON.stringify(this.currentLayout));
        }

        // ─── MESSAGE HANDLERS ───

        this.onMessage('command', (client, message) => {
            console.log(`Command from ${client.sessionId}:`, message);
        });

        this.onMessage('set-api-credentials', (client, message) => {
            const { apiKey, apiBase, model, provider } = message;
            if (provider === 'openai' && apiKey) {
                console.log(`[OfficeRoom] API credentials updated dynamically by client. Model: ${model}`);
                this.llmProvider = 'openai';
                this.llmModel = model || 'gpt-4o-mini';
                this.inferenceAdapter = new OpenAICompatibleAdapter(
                    apiBase || 'https://api.openai.com/v1',
                    apiKey,
                    'openai'
                );

                // Update core agents who don't have custom overrides
                this.coreAgents.forEach((agent, id) => {
                    const isCustomAgent = agentsList.find(a => a.id === id)?.llm;
                    if (!isCustomAgent) {
                        agent.setInferenceAdapter(this.inferenceAdapter);
                        agent.config.inference.provider = 'openai';
                        agent.config.inference.model = this.llmModel;
                    }
                });

                this.broadcast('chat', {
                    sender: '시스템',
                    text: `✅ OpenAI API Key가 성공적으로 연동되었습니다. (모델: ${this.llmModel})`
                });
            }
        });

        this.onMessage('user-hire-agent', async (client, message) => {
            const { name, role, systemPrompt, llm, personality, capabilities } = message;
            if (this.coreAgents.size >= 7) {
                client.send('chat', {
                    sender: '시스템',
                    text: '⚠️ 채용 실패: 사무실 정원이 가득 찼습니다. (최대 7명)'
                });
                return;
            }

            const hireId = `user_hire_${Date.now()}`;
            const spawnX = 20;
            const spawnY = 2;

            this.state.createAgent(hireId, name);
            const hireState = this.state.agents.get(hireId);
            if (hireState) { hireState.x = spawnX; hireState.y = spawnY; }

            let agentAdapter: InferenceAdapter = this.inferenceAdapter;
            let agentProvider = this.llmProvider;
            let agentModel = this.llmModel;

            if (llm && llm.provider) {
                agentProvider = llm.provider as any;
                agentModel = llm.model || (llm.provider === 'openai' ? 'gpt-4o-mini' : 'llama3.2:latest');
                if (llm.provider === 'openai' && llm.apiBase) {
                    agentAdapter = new OpenAICompatibleAdapter(llm.apiBase, llm.apiKey || 'sk-dummy', 'openai');
                } else if (llm.provider === 'ollama' && llm.apiBase) {
                    agentAdapter = new OllamaAdapter(llm.apiBase);
                }
            }

            // Determine capabilities mapping
            let agentCapabilities = [
                { name: 'code_execute', description: 'Execute JavaScript code' },
                { name: 'web_search', description: 'Search the web' },
                { name: 'write_note', description: 'Write a note' },
                { name: 'create_task', description: 'Create a task for the team' }
            ];

            if (capabilities && typeof capabilities === 'object') {
                const caps: any[] = [];
                if (capabilities.code_execute) caps.push({ name: 'code_execute', description: 'Execute JavaScript code' });
                if (capabilities.web_search) caps.push({ name: 'web_search', description: 'Search the web' });
                if (capabilities.write_note) caps.push({ name: 'write_note', description: 'Write a note' });
                if (capabilities.create_task) caps.push({ name: 'create_task', description: 'Create a task for the team' });
                if (caps.length > 0) {
                    agentCapabilities = caps;
                }
            }

            const hireAgent = new Agent({
                id: hireId, name, role, avatar: 'sprite.png',
                inference: {
                    provider: agentProvider,
                    model: agentModel,
                    systemPrompt: systemPrompt || `You are ${name}, a ${role} in a virtual office. Collaborate with colleagues. Keep thoughts SHORT.`,
                },
                personality: personality || {
                    traits: { openness: 0.8, conscientiousness: 0.9, extraversion: 0.7, agreeableness: 0.8, neuroticism: 0.2 },
                    communicationStyle: 'casual',
                    workHours: { start: '09:00', end: '17:00' },
                    breakFrequency: 90
                },
                capabilities: agentCapabilities,
                memory: { shortTermLimit: 50 }
            });

            hireAgent.setInferenceAdapter(agentAdapter);
            await hireAgent.initialize();
            
            this.coreAgents.set(hireId, hireAgent);
            this.thinkingLocks.set(hireId, false);
            this.rebuildRelationshipGraph();

            this.broadcast('chat', {
                sender: '🏢 두온교육 사무실',
                text: `🎉 신입 사원 ${name}(역할: ${role})님이 입사하였습니다! 환영해주세요!`
            });
            this.emitHighlight(
                'hiring',
                `${name} 입사`,
                `사용자가 직접 ${name}님을 ${role} 분야 전문가로 추가 채용했습니다.`,
                hireId
            );
        });

        this.onMessage('chat', (client, message) => {
            console.log(`Chat from ${client.sessionId}: ${message.text}`);
            this.broadcast('chat', { sender: 'User', text: message.text });
        });

        this.onMessage('start-scenario', (client, message) => {
            const scenarioName = String(message?.scenario || 'Free Play');
            this.currentScenario = scenarioName;
            this.applyScenarioKickoff(scenarioName);
        });

        this.onMessage('trigger-chaos', (client, message) => {
            const eventName = String(message?.event || 'minor_outage');
            this.applyChaosEvent(eventName);
        });

        // UI-driven task assignment
        this.onMessage('assign-task', (client, message) => {
            const { title, agentId } = message;
            console.log(`[TaskBoard] Assigning "${title}" to ${agentId || 'auto'}`);

            // Pick agent: explicit or auto-assign to least busy
            const targetId = agentId || this.autoAssignAgent();
            const agent = this.coreAgents.get(targetId);
            const agentState = this.state.agents.get(targetId);

            if (agent && agentState) {
                agent.currentTask = title;
                agentState.currentTask = title;
                agentState.action = 'work';

                // Persist task
                this.memoryStore.createTask(title, targetId);

                this.broadcast('chat', {
                    sender: 'System',
                    text: `📋 Task "${title}" assigned to ${agentState.name}`
                });

                this.broadcast('task-update', {
                    agentId: targetId,
                    agentName: agentState.name,
                    task: title,
                    status: 'in_progress'
                });
            }
        });

        // Save office layout from editor
        this.onMessage('save-layout', async (client, message) => {
            const layoutName = message.name || 'default';
            const layout = Array.isArray(message.layout) ? message.layout : [];
            await this.memoryStore.saveLayout(layoutName, JSON.stringify(layout));
            this.currentLayout = layout;
            this.broadcast('layout-sync', { name: layoutName, layout: this.currentLayout });
            this.broadcast('chat', { sender: 'System', text: '✅ Office layout saved!' });
        });

        // Start Simulation Loop
        this.setSimulationInterval((delta) => this.update(delta), 100);
    }

    private autoAssignAgent(): string {
        // Pick the agent with no current task, or the first one
        for (const [id, agent] of this.coreAgents) {
            if (!agent.currentTask) return id;
        }
        return 'alice'; // fallback
    }

    private findDynamicTarget(agentId: string, action: string): { x: number; y: number } {
        const fallback = { x: 10, y: 10 };

        // 1. 행동(action)에 따른 특수 목적지
        if (action === 'idle') {
            const coffee = this.currentLayout.find(item => item.id === 'f_coffee');
            if (coffee) return { x: coffee.x, y: coffee.y };
        } else if (action === 'think') {
            const targetId = Math.random() < 0.5 ? 'f_whiteboard' : 'f_bookshelf1';
            const obj = this.currentLayout.find(item => item.id === targetId);
            if (obj) {
                // 화이트보드나 책장의 경우 바로 앞 칸으로 이동
                return { x: obj.x, y: targetId === 'f_whiteboard' ? obj.y + 1 : obj.y };
            }
        }

        // 2. 업무용 자기 자리 (work, use_tool 등)
        if (agentId === 'jitae') {
            const chair = this.currentLayout.find(item => item.id === 'f_jitae_chair');
            if (chair) return { x: chair.x, y: chair.y };
        } else if (agentId === 'sinwu') {
            const chair = this.currentLayout.find(item => item.id === 'f_sinwu_chair');
            if (chair) return { x: chair.x, y: chair.y };
        } else if (agentId === 'mina') {
            const chair = this.currentLayout.find(item => item.id === 'f_mina_chair');
            if (chair) return { x: chair.x, y: chair.y };
        } else if (agentId === 'yujin') {
            const chair = this.currentLayout.find(item => item.id === 'f_yujin_chair');
            if (chair) return { x: chair.x, y: chair.y };
        } else {
            // 신입 사원 (user_hire_* 또는 hire_*)
            const allAgentIds = Array.from(this.state.agents.keys()).sort();
            const hireAgentIds = allAgentIds.filter(id => !['jitae', 'sinwu', 'mina', 'yujin'].includes(id));
            const myIndex = hireAgentIds.indexOf(agentId);

            if (myIndex === 0) {
                const chair = this.currentLayout.find(item => item.id === 'f_vacant_chair1');
                if (chair) return { x: chair.x, y: chair.y };
            } else if (myIndex === 1) {
                const chair = this.currentLayout.find(item => item.id === 'f_vacant_chair2');
                if (chair) return { x: chair.x, y: chair.y };
            } else {
                const chair = this.currentLayout.find(item => item.id === 'f_lounge_chair1');
                if (chair) return { x: chair.x, y: chair.y };
            }
        }

        return fallback;
    }

    async update(delta: number) {
        if (Math.random() < 0.02) {
            console.log(`[Server] Agents: ${this.state.agents.size} | Session: ${this.sessionId}`);
        }

        this.state.officeTime = new Date().toISOString();

        // ─── AGENT THINK CYCLE ───
        this.coreAgents.forEach((coreAgent, id) => {
            if (!this.thinkingLocks.get(id)) {
                this.thinkingLocks.set(id, true);

                const agentState = this.state.agents.get(id);
                if (!agentState) return;

                // Build nearby agents list
                const nearbyAgents: { name: string; role: string; distance: number }[] = [];
                this.coreAgents.forEach((other, otherId) => {
                    if (otherId === id) return;
                    const otherState = this.state.agents.get(otherId);
                    if (otherState) {
                        const dist = Math.abs(agentState.x - otherState.x) + Math.abs(agentState.y - otherState.y);
                        nearbyAgents.push({ name: other.config.name, role: other.config.role, distance: dist });
                    }
                });

                coreAgent.think({
                    time: this.state.officeTime,
                    location: `${agentState.x},${agentState.y}`,
                    nearbyAgents,
                    currentTask: coreAgent.currentTask || null,
                    recentMessages: coreAgent.getUnreadMessages(),
                    memories: coreAgent.getRecentMemories(5)
                }).then(async (decision) => {
                    agentState.action = decision.action;

                    if (decision.thought) {
                        agentState.thought = decision.thought;
                    }

                    // ─── HANDLE TALK ACTION (Agent-to-Agent) ───
                    if (decision.action === 'talk' && decision.message) {
                        const targetName = decision.target || '';
                        let targetId = '';
                        this.coreAgents.forEach((a, aId) => {
                            if (a.config.name.toLowerCase() === targetName.toLowerCase()) targetId = aId;
                        });

                        const targetAgent = this.coreAgents.get(targetId);
                        if (targetAgent) {
                            const msg: ConversationMessage = {
                                from: coreAgent.config.name,
                                to: targetAgent.config.name,
                                content: decision.message,
                                timestamp: this.state.officeTime
                            };
                            targetAgent.receiveMessage(msg);

                            // Broadcast to UI chat
                            this.broadcast('chat', {
                                sender: coreAgent.config.name,
                                text: `💬 (to ${targetAgent.config.name}): ${decision.message}`
                            });
                            this.emitHighlight(
                                'conversation',
                                `${coreAgent.config.name} pinged ${targetAgent.config.name}`,
                                decision.message.slice(0, 120),
                                id
                            );
                            this.updateRelationship(id, targetId, 0.08);

                            // Save conversation memory
                            await this.memoryStore.saveMemory(id, {
                                content: `Said to ${targetAgent.config.name}: "${decision.message}"`,
                                type: 'conversation',
                                timestamp: this.state.officeTime,
                                importance: 0.7
                            }, this.sessionId);
                        }

                        coreAgent.clearInbox(); // Clear after processing
                    }

                    // ─── HANDLE TOOL EXECUTION ───
                    if (decision.action === 'use_tool' && decision.toolCall) {
                        // Special case: agent-created tasks
                        if (decision.toolCall.name === 'create_task') {
                            const { title, assignee } = decision.toolCall.params;
                            const targetId = assignee?.toLowerCase() || this.autoAssignAgent();
                            const targetAgent = this.coreAgents.get(targetId);
                            const targetState = this.state.agents.get(targetId);

                            if (targetAgent && targetState) {
                                targetAgent.currentTask = title;
                                targetState.currentTask = title;
                                await this.memoryStore.createTask(title, targetId);

                                this.broadcast('chat', {
                                    sender: coreAgent.config.name,
                                    text: `📋 Created task "${title}" for ${targetAgent.config.name}`
                                });
                                this.broadcast('task-update', {
                                    agentId: targetId,
                                    agentName: targetAgent.config.name,
                                    task: title,
                                    status: 'in_progress'
                                });
                                this.emitHighlight(
                                    'task',
                                    `${coreAgent.config.name} assigned work`,
                                    `"${title}" is now owned by ${targetAgent.config.name}.`,
                                    targetId
                                );
                            }
                        } else if (decision.toolCall.name === 'hire_agent') {
                            // ─── DYNAMIC AGENT HIRING ───
                            const hireParams = decision.toolCall.params;
                            const hireName = hireParams.name || ['Charlie', 'Diana', 'Eve', 'Frank', 'Grace'][this.hireCount % 5];
                            const hireRole = hireParams.role || 'Intern';
                            const hireId = `hire_${this.hireCount}`;

                            if (this.hireCount < 5 && !this.coreAgents.has(hireId)) {
                                // Spawn at office door (top-center), then walk to their desk
                                const spawnX = 20;
                                const spawnY = 2;

                                this.state.createAgent(hireId, hireName);
                                const hireState = this.state.agents.get(hireId);
                                if (hireState) { hireState.x = spawnX; hireState.y = spawnY; }

                                const hireAgent = new Agent({
                                    id: hireId, name: hireName, role: hireRole, avatar: 'sprite.png',
                                    inference: {
                                        provider: this.llmProvider,
                                        model: this.llmModel,
                                        systemPrompt: `You are ${hireName}, a ${hireRole} who just joined the team at a virtual office. You were hired by ${coreAgent.config.name}. Be enthusiastic, helpful, and eager to learn. Introduce yourself to your colleagues. Keep thoughts SHORT.`,
                                    },
                                    personality: {
                                        traits: { openness: 0.9, conscientiousness: 0.7, extraversion: 0.8, agreeableness: 0.9, neuroticism: 0.2 },
                                        communicationStyle: hireRole.includes('Design') ? 'creative' : 'casual',
                                        workHours: { start: '09:00', end: '17:00' },
                                        breakFrequency: 90
                                    },
                                    capabilities: [
                                        { name: 'code_execute', description: 'Execute JavaScript code' },
                                        { name: 'web_search', description: 'Search the web' },
                                        { name: 'write_note', description: 'Write a note' },
                                        { name: 'create_task', description: 'Create a task for the team' }
                                    ],
                                    memory: { shortTermLimit: 50 }
                                });

                                hireAgent.setInferenceAdapter(this.inferenceAdapter);
                                await hireAgent.initialize();
                                this.coreAgents.set(hireId, hireAgent);
                                this.thinkingLocks.set(hireId, false);

                                this.hireCount++;
                                this.rebuildRelationshipGraph();

                                this.broadcast('chat', {
                                    sender: '🏢 두온교육 사무실',
                                    text: `🎉 ${coreAgent.config.name} hired ${hireName} as ${hireRole}! Welcome to the team!`
                                });
                                this.emitHighlight(
                                    'hiring',
                                    `${hireName} joined the team`,
                                    `${coreAgent.config.name} hired ${hireName} (${hireRole}).`,
                                    hireId
                                );

                                // Give the hiring agent a memory of the hire
                                coreAgent.addMemory({
                                    content: `I hired ${hireName} as a ${hireRole}. They just joined the team.`,
                                    type: 'achievement',
                                    timestamp: this.state.officeTime,
                                    importance: 0.9
                                });
                            } else if (this.hireCount >= 5) {
                                this.broadcast('chat', {
                                    sender: '🏢 두온교육 사무실',
                                    text: `⚠️ ${coreAgent.config.name} tried to hire but the office is full! (Max 7 agents)`
                                });
                            }
                        } else {
                            const result = await this.toolExecutor.execute(
                                decision.toolCall.name,
                                decision.toolCall.params
                            );

                            this.broadcast('chat', {
                                sender: coreAgent.config.name,
                                text: `🔧 Used tool [${decision.toolCall.name}]: ${result.success ? result.output.slice(0, 100) : result.error}`
                            });
                            this.emitHighlight(
                                'tool',
                                `${coreAgent.config.name} used ${decision.toolCall.name}`,
                                (result.success ? result.output : result.error || 'Tool failed').slice(0, 120),
                                id
                            );

                            coreAgent.addMemory({
                                content: `Tool ${decision.toolCall.name} result: ${result.output.slice(0, 200)}`,
                                type: 'task_result',
                                timestamp: this.state.officeTime,
                                importance: 0.8
                            });
                        }
                    }

                    // ─── PERSIST MEMORIES PERIODICALLY ───
                    if (Math.random() < 0.3) {
                        const recentMemories = coreAgent.memories.slice(-3);
                        await this.memoryStore.saveMemories(id, recentMemories, this.sessionId);
                    }

                    setTimeout(() => this.thinkingLocks.set(id, false), 15000);

                }).catch(err => {
                    console.error(`Agent ${id} think error:`, err);
                    
                    // LLM 실패 시의 Fallback Behavior Planner (에이전트별 개별 행동 분산)
                    const fallbackActions = ['work', 'talk', 'think', 'idle', 'use_tool'];
                    let action = 'work';
                    const rand = Math.random();
                    if (coreAgent.config.role === 'PM') {
                        action = rand < 0.3 ? 'think' : (rand < 0.6 ? 'talk' : (rand < 0.85 ? 'work' : 'idle'));
                    } else if (coreAgent.config.role === '엔지니어') {
                        action = rand < 0.5 ? 'work' : (rand < 0.8 ? 'use_tool' : (rand < 0.9 ? 'idle' : 'think'));
                    } else if (coreAgent.config.role === '디자이너') {
                        action = rand < 0.4 ? 'work' : (rand < 0.7 ? 'think' : (rand < 0.9 ? 'idle' : 'talk'));
                    } else if (coreAgent.config.role === '마케터') {
                        action = rand < 0.4 ? 'talk' : (rand < 0.7 ? 'work' : (rand < 0.9 ? 'idle' : 'think'));
                    } else {
                        action = rand < 0.4 ? 'work' : (rand < 0.6 ? 'idle' : (rand < 0.8 ? 'talk' : 'think'));
                    }

                    agentState.action = action;

                    // 상태에 알맞은 한글 생각 텍스트 매핑
                    const thoughtsMap: Record<string, string[]> = {
                        'work': [
                            '오늘 마일스톤 기획안 작성을 어서 끝내야겠어.',
                            '타입스크립트 컴파일 오류 해결하는 중...',
                            'UI 피그마 디자인 시안을 다듬고 있어🎨',
                            '이번 분기 마케팅 성과 대시보드를 검토 중📊'
                        ],
                        'talk': [
                            '최근 요구사항 변경건에 대해 팀원과 논의해봐야겠다.',
                            '오늘 퇴근하고 가볍게 저녁이나 같이 하자고 할까?',
                            '신규 기능 배포 일정에 대해 PM님이랑 이야기 해봐야지.'
                        ],
                        'think': [
                            '다음 스프린트 기획 아이디어를 메모장에 정리해두자💡',
                            '개발 서적을 찾아 도서관 서재를 훑어보는 중...',
                            '중앙 회의실 화이트보드에 아이디어를 그려봐야겠다.'
                        ],
                        'idle': [
                            '일이 잘 안 풀릴 땐 역시 탕비실 커피가 최고야☕',
                            '라운지 테이블 소파에서 잠깐 쉬면서 스트레칭 중😌',
                            '가볍게 물 한 모금 마시러 다녀오자.'
                        ],
                        'use_tool': [
                            '웹 서칭으로 오픈소스 최신 트렌드를 검색 중🔍',
                            '동작 코드 스크립트 결과를 로컬 파일에 기록하고 있어.',
                            '메모 도구를 실행해서 금일 할 일을 기록해둬야겠다.'
                        ]
                    };
                    const thoughts = thoughtsMap[action] || thoughtsMap['work'];
                    agentState.thought = thoughts[Math.floor(Math.random() * thoughts.length)];

                    // talk 액션 시 채팅 브로드캐스트
                    if (action === 'talk') {
                        const otherAgents = Array.from(this.state.agents.keys()).filter(otherId => otherId !== id);
                        if (otherAgents.length > 0) {
                            const targetId = otherAgents[Math.floor(Math.random() * otherAgents.length)];
                            const targetState = this.state.agents.get(targetId);
                            if (targetState) {
                                const msgs = [
                                    `오늘 업무 진행 건에 대해 간단히 회의할까요?`,
                                    `그 가구 배치 정말 깔끔하네요! 맘에 듭니다.`,
                                    `혹시 다음 릴리즈 마일스톤 공유받으셨나요?`,
                                    `잠깐 머리 식힐 겸 탕비실에서 차 한잔 하실래요?`
                                ];
                                const msgText = msgs[Math.floor(Math.random() * msgs.length)];
                                this.broadcast('chat', {
                                    sender: agentState.name,
                                    text: `💬 (to ${targetState.name}): ${msgText}`
                                });
                                this.updateRelationship(id, targetId, 0.05);
                            }
                        }
                    }

                    setTimeout(() => this.thinkingLocks.set(id, false), 15000);
                });
            }
        });

        // ─── FURNITURE INTERACTION PATHFINDING ───
        // Office grid boundaries (agents must stay inside)
        const BOUNDS = { minX: 2, maxX: 36, minY: 2, maxY: 36 };
        const clamp = (agent: any) => {
            agent.x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, agent.x));
            agent.y = Math.max(BOUNDS.minY, Math.min(BOUNDS.maxY, agent.y));
        };

        this.demoTickCount++;
        if (this.demoTickCount >= 5) {
            this.demoTickCount = 0;

            const isTileOccupied = (tx: number, ty: number, excludeId: string): boolean => {
                let occupied = false;
                this.state.agents.forEach((other, otherKey) => {
                    if (otherKey !== excludeId && Math.round(other.x) === tx && Math.round(other.y) === ty) {
                        occupied = true;
                    }
                });
                return occupied;
            };

            this.state.agents.forEach((agent, key) => {
                let target = this.findDynamicTarget(key, agent.action);

                // If agent action is 'talk', move towards the other agent instead
                if (agent.action === 'talk') {
                    let closest: { x: number; y: number } | null = null;
                    let minDist = Infinity;
                    this.state.agents.forEach((other, otherKey) => {
                        if (otherKey === key) return;
                        const dist = Math.abs(agent.x - other.x) + Math.abs(agent.y - other.y);
                        if (dist < minDist) { 
                            minDist = dist; 
                            closest = { x: other.x, y: other.y + 1 }; // 겹침 회비를 위해 다른 에이전트의 바로 옆 칸(y+1)을 타겟으로 함
                        }
                    });
                    if (closest) {
                        target = closest;
                    }
                }

                // 만약 타겟에 이미 정확히 도착했다면 이동을 생략
                if (agent.x === target.x && agent.y === target.y) {
                    this.updateAgentViralMetrics(key, agent.action);
                    return;
                }

                // 1차 이상적인 다음 전진 픽셀 후보 계산 (1축씩 순차 이동)
                let nextX = agent.x;
                let nextY = agent.y;

                if (agent.x < target.x) nextX = agent.x + 1;
                else if (agent.x > target.x) nextX = agent.x - 1;
                else if (agent.y < target.y) nextY = agent.y + 1;
                else if (agent.y > target.y) nextY = agent.y - 1;

                // 다음 후보지가 타인에게 점유되어 충돌이 나는지 진단
                if (isTileOccupied(nextX, nextY, key)) {
                    // 충돌 발생: 4방향 우회 경로 탐색 (Side-stepping)
                    const directions = [
                        { x: agent.x + 1, y: agent.y },
                        { x: agent.x - 1, y: agent.y },
                        { x: agent.x, y: agent.y + 1 },
                        { x: agent.x, y: agent.y - 1 }
                    ];

                    let bestTile: { x: number; y: number } | null = null;
                    let bestDist = Infinity;

                    for (const dir of directions) {
                        // BOUNDS 경계 검사
                        if (dir.x < BOUNDS.minX || dir.x > BOUNDS.maxX || dir.y < BOUNDS.minY || dir.y > BOUNDS.maxY) {
                            continue;
                        }
                        // 타인 점유 여부 검사
                        if (isTileOccupied(dir.x, dir.y, key)) {
                            continue;
                        }
                        // 최종 목적지와의 맨해튼 거리 계산
                        const dist = Math.abs(dir.x - target.x) + Math.abs(dir.y - target.y);
                        if (dist < bestDist) {
                            bestDist = dist;
                            bestTile = dir;
                        }
                    }

                    if (bestTile) {
                        agent.x = bestTile.x;
                        agent.y = bestTile.y;
                    }
                    // 우회할 수 있는 빈 타일이 없으면 멈춰 서서 제자리에 대기
                } else {
                    // 충돌 없음: 예정된 방향으로 한 칸 전진
                    agent.x = nextX;
                    agent.y = nextY;
                }

                clamp(agent);

                // Keep viral telemetry alive for UI overlays and highlights.
                this.updateAgentViralMetrics(key, agent.action);
            });
        }
    }

    private clamp01(value: number): number {
        return Math.max(0, Math.min(1, value));
    }

    private emitHighlight(type: string, title: string, body: string, agentId?: string) {
        const payload: HighlightEvent = {
            type,
            title,
            body,
            agentId: agentId || null,
            scenario: this.currentScenario,
            time: this.state.officeTime
        };
        this.highlights = [payload, ...this.highlights].slice(0, 200);
        this.broadcast('highlight-event', payload);
    }

    private updateAgentViralMetrics(agentId: string, action: string) {
        const state = this.state.agents.get(agentId);
        if (!state) return;
        const jitter = (Math.random() - 0.5) * 0.03;
        const actionBoost =
            action === 'work' ? 0.015 :
                action === 'talk' ? 0.02 :
                    action === 'use_tool' ? 0.03 :
                        -0.005;

        state.momentum = this.clamp01(state.momentum + actionBoost + jitter);
        state.riskLevel = this.clamp01(state.riskLevel + (action === 'use_tool' ? 0.02 : -0.004) + jitter);
        state.mood = this.clamp01(state.mood + (action === 'talk' ? 0.02 : -0.002) + jitter);
        state.reputation = this.clamp01(state.reputation + (action === 'work' ? 0.015 : 0.001) + jitter / 2);
    }

    private applyScenarioKickoff(scenarioName: string) {
        this.broadcast('scenario-event', {
            type: 'scenario-started',
            scenario: scenarioName,
            time: this.state.officeTime
        });

        this.broadcast('chat', {
            sender: '🎬 Producer',
            text: `Scenario loaded: ${scenarioName}. Let the office drama begin.`
        });

        this.emitHighlight(
            'scenario',
            `Scenario: ${scenarioName}`,
            `The office switched into ${scenarioName} mode.`,
        );

        this.state.agents.forEach((agent, id) => {
            agent.momentum = this.clamp01(agent.momentum + 0.15);
            agent.riskLevel = this.clamp01(agent.riskLevel + 0.1);
            if (Math.random() < 0.4) {
                this.emitHighlight(
                    'character_arc',
                    `${agent.name} steps up`,
                    `${agent.name} is pushing hard as ${scenarioName} starts.`,
                    id
                );
            }
        });
    }

    private applyChaosEvent(eventName: string) {
        const chaosMap: Record<string, { label: string; moodDelta: number; riskDelta: number; momentumDelta: number }> = {
            server_outage: { label: 'Server Outage', moodDelta: -0.25, riskDelta: 0.35, momentumDelta: 0.1 },
            funding_cut: { label: 'Funding Cut', moodDelta: -0.2, riskDelta: 0.28, momentumDelta: -0.05 },
            surprise_launch: { label: 'Surprise Launch', moodDelta: 0.12, riskDelta: 0.22, momentumDelta: 0.25 },
            client_escalation: { label: 'Client Escalation', moodDelta: -0.1, riskDelta: 0.3, momentumDelta: 0.08 },
            viral_tweet: { label: 'Viral Tweet', moodDelta: 0.25, riskDelta: 0.12, momentumDelta: 0.3 }
        };

        const selected = chaosMap[eventName] || chaosMap.server_outage;
        this.chaosHistory = [
            { event: eventName, label: selected.label, time: this.state.officeTime },
            ...this.chaosHistory
        ].slice(0, 100);
        this.broadcast('scenario-event', {
            type: 'chaos-triggered',
            event: eventName,
            label: selected.label,
            time: this.state.officeTime
        });

        this.broadcast('chat', {
            sender: '⚠️ Chaos Engine',
            text: `${selected.label} hit the office. Everyone reacts in real-time.`
        });

        this.emitHighlight(
            'chaos',
            selected.label,
            `Chaos event "${selected.label}" changed team mood and risk levels.`
        );

        this.state.agents.forEach((agent, id) => {
            agent.mood = this.clamp01(agent.mood + selected.moodDelta + (Math.random() - 0.5) * 0.08);
            agent.riskLevel = this.clamp01(agent.riskLevel + selected.riskDelta + Math.random() * 0.08);
            agent.momentum = this.clamp01(agent.momentum + selected.momentumDelta + (Math.random() - 0.5) * 0.05);
            if (agent.riskLevel > 0.75) {
                this.emitHighlight(
                    'high_risk',
                    `${agent.name} is under pressure`,
                    `${agent.name}'s risk level spiked after ${selected.label}.`,
                    id
                );
            }
        });

        // Chaos can create alliances or rivalries.
        const ids = Array.from(this.state.agents.keys());
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const delta = (Math.random() - 0.5) * 0.35;
                this.updateRelationship(ids[i], ids[j], delta);
            }
        }
    }

    private relationshipKey(a: string, b: string): string {
        return [a, b].sort().join('::');
    }

    private statusFromScore(score: number): RelationshipEdge['status'] {
        if (score > 0.35) return 'alliance';
        if (score < -0.35) return 'rivalry';
        return 'neutral';
    }

    private rebuildRelationshipGraph() {
        const ids = Array.from(this.state.agents.keys());
        for (let i = 0; i < ids.length; i++) {
            for (let j = i + 1; j < ids.length; j++) {
                const key = this.relationshipKey(ids[i], ids[j]);
                if (!this.relationships.has(key)) {
                    this.relationships.set(key, {
                        a: ids[i],
                        b: ids[j],
                        score: 0,
                        status: 'neutral',
                        updatedAt: this.state.officeTime
                    });
                }
            }
        }
        this.emitRelationshipGraph();
    }

    private updateRelationship(a: string, b: string, delta: number) {
        const key = this.relationshipKey(a, b);
        const existing = this.relationships.get(key) || {
            a: [a, b].sort()[0],
            b: [a, b].sort()[1],
            score: 0,
            status: 'neutral' as const,
            updatedAt: this.state.officeTime
        };
        const score = Math.max(-1, Math.min(1, existing.score + delta));
        const updated: RelationshipEdge = {
            ...existing,
            score,
            status: this.statusFromScore(score),
            updatedAt: this.state.officeTime
        };
        this.relationships.set(key, updated);
        this.emitRelationshipGraph();
    }

    private emitRelationshipGraph() {
        this.broadcast('relationship-update', this.buildRelationshipPayload());
    }

    private buildRelationshipPayload() {
        const idToName: Record<string, string> = {};
        this.state.agents.forEach((agent, id) => {
            idToName[id] = agent.name;
        });
        return {
            edges: Array.from(this.relationships.values()).map((edge) => ({
                ...edge,
                aName: idToName[edge.a] || edge.a,
                bName: idToName[edge.b] || edge.b
            })),
            time: this.state.officeTime
        };
    }

    public registerAudienceVote(eventName: string, voterId?: string) {
        const normalized = String(eventName || 'server_outage');
        this.audienceVotes[normalized] = (this.audienceVotes[normalized] || 0) + 1;
        const totalVotes = Object.values(this.audienceVotes).reduce((sum, value) => sum + value, 0);
        const shouldTrigger = this.audienceVotes[normalized] >= 3 || totalVotes % 5 === 0;

        if (shouldTrigger) {
            this.applyChaosEvent(normalized);
            this.emitHighlight(
                'audience_vote',
                `Audience triggered ${normalized}`,
                `Viewers forced a ${normalized} chaos event.`
            );
            this.audienceVotes[normalized] = 0;
        }

        return {
            accepted: true,
            event: normalized,
            voterId: voterId || null,
            tally: this.audienceVotes[normalized] || 0,
            triggered: shouldTrigger
        };
    }

    public getEpisodeRecap() {
        const topHighlights = [...this.highlights].slice(0, 10);
        const leaderboard = Array.from(this.state.agents.entries()).map(([id, agent]) => {
            const impact = (
                agent.momentum * 0.35 +
                agent.reputation * 0.3 +
                agent.mood * 0.2 +
                (1 - agent.riskLevel) * 0.15
            );
            return {
                id,
                name: agent.name,
                action: agent.action,
                mood: agent.mood,
                reputation: agent.reputation,
                riskLevel: agent.riskLevel,
                momentum: agent.momentum,
                impact: Number(impact.toFixed(3))
            };
        }).sort((a, b) => b.impact - a.impact);

        const avgMomentum = leaderboard.length
            ? leaderboard.reduce((sum, item) => sum + item.momentum, 0) / leaderboard.length
            : 0;
        const avgRisk = leaderboard.length
            ? leaderboard.reduce((sum, item) => sum + item.riskLevel, 0) / leaderboard.length
            : 0;
        const outcome = avgMomentum > 0.65 && avgRisk < 0.5
            ? 'Launch trajectory: team executed under pressure and came out stronger.'
            : avgRisk > 0.65
                ? 'High volatility: chaos dominated this episode.'
                : 'Mixed outcome: strong moments with unresolved tensions.';

        return {
            generatedAt: this.state.officeTime,
            scenario: this.currentScenario,
            topHighlights,
            leaderboard: leaderboard.slice(0, 10),
            outcomeCard: {
                title: `${this.currentScenario} Outcome`,
                summary: outcome,
                chaosEvents: this.chaosHistory.slice(0, 10),
                activeRelationships: Array.from(this.relationships.values()).filter((edge) => edge.status !== 'neutral').length
            }
        };
    }

    onJoin(client: Client, options: any) {
        console.log(client.sessionId, "joined the office room!");
        // Send existing tasks to newly joined client
        this.memoryStore.getTasks().then(tasks => {
            client.send('tasks-sync', tasks);
        });
        client.send('relationship-update', this.buildRelationshipPayload());
        client.send('layout-sync', { name: 'default', layout: this.currentLayout });
    }

    onLeave(client: Client, consented: boolean) {
        console.log(client.sessionId, "left the office room!");
    }

    async onDispose() {
        console.log("room", this.roomId, "disposing... saving memories");
        OfficeRoom.activeRoom = null;
        // Persist all agent memories on shutdown
        for (const [id, agent] of this.coreAgents) {
            await this.memoryStore.saveMemories(id, agent.memories, this.sessionId);
        }
        await this.memoryStore.close();
    }
}
