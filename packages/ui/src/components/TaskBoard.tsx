import React, { useState, useEffect } from 'react';
import { getColyseusRoom } from '../game/Game';
import { FloatingPanel } from './FloatingPanel';

interface TaskItem {
    id: number;
    title: string;
    assigned_to: string;
    status: string;
}

export function TaskBoard() {
    const [tasks, setTasks] = useState<TaskItem[]>([]);
    const [newTask, setNewTask] = useState('');
    const [targetAgent, setTargetAgent] = useState('auto');
    const [activeAgents, setActiveAgents] = useState<{ id: string, name: string }[]>([]);

    useEffect(() => {
        const checkRoom = setInterval(() => {
            const room = getColyseusRoom();
            if (room) {
                room.onMessage('task-update', (data: any) => {
                    setTasks(prev => {
                        const existing = prev.find(t => t.title === data.task);
                        if (existing) {
                            return prev.map(t => t.title === data.task ? { ...t, status: data.status, assigned_to: data.agentId } : t);
                        }
                        return [...prev, { id: Date.now(), title: data.task, assigned_to: data.agentId, status: data.status }];
                    });
                });
                room.onMessage('tasks-sync', (serverTasks: any[]) => {
                    setTasks(serverTasks.map(t => ({
                        id: t.id,
                        title: t.title,
                        assigned_to: t.assigned_to || '',
                        status: t.status
                    })));
                });

                // Sync agents list
                const updateAgentsList = () => {
                    const list: { id: string, name: string }[] = [];
                    room.state.agents.forEach((agent: any, id: string) => {
                        list.push({ id, name: agent.name });
                    });
                    setActiveAgents(list);
                };

                room.state.agents.onAdd(() => updateAgentsList());
                room.state.agents.onRemove(() => updateAgentsList());
                updateAgentsList(); // Initial sync

                clearInterval(checkRoom);
            }
        }, 500);
        return () => clearInterval(checkRoom);
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTask.trim()) return;
        const room = getColyseusRoom();
        if (room) {
            room.send('assign-task', { title: newTask, agentId: targetAgent === 'auto' ? undefined : targetAgent });
            setNewTask('');
        }
    };

    const statusColor = (s: string) => {
        if (s === 'completed') return '#00b894';
        if (s === 'in_progress') return '#fdcb6e';
        return '#dfe6e9';
    };

    const statusIcon = (s: string) => {
        if (s === 'completed') return '✅';
        if (s === 'in_progress') return '🔄';
        return '⏳';
    };

    return (
        <FloatingPanel
            id="task-board"
            title="📋 작업 보드"
            subtitle="작업 할당 및 진행도"
            width={280}
            defaultDock="left"
            defaultY={20}
            zIndex={12}
        >
            <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '42vh' }}>
                {/* Task Assignment Form */}
                <form onSubmit={handleSubmit} style={{ marginBottom: 10 }}>
                    <input
                        type="text"
                        value={newTask}
                        onChange={(e) => setNewTask(e.target.value)}
                        placeholder="새 작업 지시 입력..."
                        style={{
                            width: '100%', padding: '8px 10px', borderRadius: 6,
                            border: '1px solid #444', backgroundColor: '#1a1a3e',
                            color: 'white', fontSize: '12px', outline: 'none',
                            boxSizing: 'border-box', marginBottom: 6
                        }}
                    />
                    <div style={{ display: 'flex', gap: 6 }}>
                        <select
                            value={targetAgent}
                            onChange={(e) => setTargetAgent(e.target.value)}
                            style={{
                                flex: 1, padding: '6px', borderRadius: 6,
                                border: '1px solid #444', backgroundColor: '#1a1a3e',
                                color: '#aaa', fontSize: '11px'
                            }}
                        >
                            <option value="auto">🤖 자동 할당</option>
                            {activeAgents.map(a => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                        </select>
                        <button type="submit" style={{
                            padding: '6px 14px', borderRadius: 6, border: 'none',
                            backgroundColor: '#6c5ce7', color: 'white', fontSize: '11px',
                            cursor: 'pointer', fontWeight: 'bold'
                        }}>
                            할당
                        </button>
                    </div>
                </form>

                {/* Task List */}
                <div style={{ flex: 1, overflowY: 'auto', fontSize: '12px', maxHeight: '25vh' }}>
                    {tasks.length === 0 && (
                        <p style={{ color: '#666', fontStyle: 'italic', margin: 0, fontSize: '11px' }}>
                            아직 할당된 작업이 없습니다. 위 입력창에 지시사항을 적어 업무를 시작해보세요!
                        </p>
                    )}
                    {tasks.map(task => (
                        <div key={task.id} style={{
                            padding: '6px 8px', marginBottom: 4, borderRadius: 6,
                            backgroundColor: 'rgba(255,255,255,0.05)',
                            borderLeft: `3px solid ${statusColor(task.status)}`
                        }}>
                            <div style={{ fontWeight: 'bold', fontSize: '11px' }}>
                                {statusIcon(task.status)} {task.title}
                            </div>
                            <div style={{ fontSize: '10px', color: '#888', marginTop: 2 }}>
                                → {task.assigned_to || '미할당'}
                            </div>
                        </div>
                    ))}
                </div>

                <div style={{ marginTop: 8, fontSize: '10px', color: '#555', borderTop: '1px solid #333', paddingTop: 6 }}>
                    🤖 엔진: LLM 멀티 백엔드 • 💾 SQLite 영구 저장소
                </div>
            </div>
        </FloatingPanel>
    );
}
