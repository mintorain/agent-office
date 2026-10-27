import React, { useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { TaskBoard } from './components/TaskBoard';
import { AgentInspector } from './components/AgentInspector';
import { LayoutEditor } from './components/LayoutEditor';
import { SystemLog } from './components/SystemLog';
import { ViralControlPanel } from './components/ViralControlPanel';
import { HighlightsFeed } from './components/HighlightsFeed';
import { AgentPulseBoard } from './components/AgentPulseBoard';
import { RelationshipGraph } from './components/RelationshipGraph';
import { EpisodeRecapPanel } from './components/EpisodeRecapPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { HiringPanel } from './components/HiringPanel';

export function App() {
    const [isHiringOpen, setIsHiringOpen] = useState(false);

    return (
        <>
            <div style={{ position: 'absolute', bottom: 20, left: 20, color: 'white', backgroundColor: 'rgba(10,10,30,0.85)', padding: '12px 16px', borderRadius: '10px', zIndex: 10, border: '1px solid rgba(108,92,231,0.3)' }}>
                <h1 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: 8 }}>🏢 두온교육 사무실</h1>
                <p style={{ margin: '4px 0 0', opacity: 0.6, fontSize: '11px' }}>실시간 멀티 에이전트 AI 시뮬레이션</p>
            </div>
            <ChatPanel />
            <TaskBoard />
            <AgentInspector agent={{ name: 'Alice', role: 'Engineer', status: 'Idle', currentTask: 'Write Scaffold' }} />
            <LayoutEditor />
            <SettingsPanel />
            <HiringPanel isOpen={isHiringOpen} onClose={() => setIsHiringOpen(false)} />
            <SystemLog />
            <ViralControlPanel />
            <RelationshipGraph />
            <HighlightsFeed />
            <AgentPulseBoard />
            <EpisodeRecapPanel />

            {/* 직원 채용 버튼 */}
            <button
                onClick={() => setIsHiringOpen(true)}
                style={{
                    position: 'absolute',
                    left: 20,
                    bottom: 190,
                    padding: '8px 16px',
                    borderRadius: 8,
                    border: 'none',
                    backgroundColor: '#6c5ce7',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    boxShadow: '0 4px 12px rgba(108,92,231,0.4)',
                    zIndex: 10
                }}
            >
                👥 직원 채용
            </button>
        </>
    );
}
