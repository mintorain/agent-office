import React from 'react';

export function AgentInspector({ agent }: { agent?: any }) {
    if (!agent) return null;
    return (
        <div style={{ position: 'absolute', right: 20, top: 20, width: 250, backgroundColor: 'rgba(0,0,0,0.8)', color: 'white', padding: 16, borderRadius: 8 }}>
            <h3 style={{ margin: '0 0 10px 0' }}>상세 보기: {agent.name}</h3>
            <div style={{ fontSize: '14px' }}>
                <p style={{ margin: '4px 0' }}><strong>역할:</strong> {agent.role}</p>
                <p style={{ margin: '4px 0' }}><strong>상태:</strong> {agent.status}</p>
                <p style={{ margin: '4px 0' }}><strong>진행 중인 작업:</strong> {agent.currentTask || '없음'}</p>
            </div>
        </div>
    );
}
