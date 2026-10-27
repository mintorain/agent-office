import React, { useEffect, useState } from 'react';
import { getColyseusRoom } from '../game/Game';
import { FloatingPanel } from './FloatingPanel';

export function SettingsPanel() {
    const [isOpen, setIsOpen] = useState(false);
    const [apiKey, setApiKey] = useState(() => localStorage.getItem('setting:apiKey') || '');
    const [apiBase, setApiBase] = useState(() => localStorage.getItem('setting:apiBase') || 'https://api.openai.com/v1');
    const [model, setModel] = useState(() => localStorage.getItem('setting:model') || 'gpt-4o-mini');
    const [status, setStatus] = useState('');

    // Auto-sync configuration on server connect
    useEffect(() => {
        const interval = setInterval(() => {
            const room = getColyseusRoom();
            if (room && apiKey) {
                room.send('set-api-credentials', {
                    provider: 'openai',
                    apiKey,
                    apiBase,
                    model
                });
                clearInterval(interval);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [apiKey, apiBase, model]);

    const handleSave = (e: React.FormEvent) => {
        e.preventDefault();
        if (!apiKey.trim()) {
            setStatus('API 키를 입력해주세요.');
            return;
        }

        // Save to localStorage
        localStorage.setItem('setting:apiKey', apiKey);
        localStorage.setItem('setting:apiBase', apiBase);
        localStorage.setItem('setting:model', model);

        // Send to server
        const room = getColyseusRoom();
        if (room) {
            room.send('set-api-credentials', {
                provider: 'openai',
                apiKey,
                apiBase,
                model
            });
            setStatus('설정이 저장되었으며 서버에 연동되었습니다.');
            setTimeout(() => setStatus(''), 3000);
        } else {
            setStatus('오류: 서버 연결이 끊겼습니다.');
        }
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                style={{
                    position: 'absolute',
                    left: 20,
                    bottom: 140,
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
                ⚙️ API 환경설정
            </button>
        );
    }

    return (
        <FloatingPanel
            id="api-settings"
            title="⚙️ API 환경설정"
            subtitle="ChatGPT API 키 연동"
            width={280}
            defaultDock="left"
            defaultY={140}
            zIndex={21}
        >
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        onClick={() => setIsOpen(false)}
                        style={{
                            background: 'rgba(255,255,255,0.08)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            color: '#aaa',
                            cursor: 'pointer',
                            fontSize: '11px',
                            borderRadius: 4,
                            padding: '3px 6px'
                        }}
                    >
                        닫기
                    </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: '11px', color: '#c9cff8' }}>OpenAI API Key</label>
                    <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="sk-proj-..."
                        style={{
                            padding: '8px',
                            borderRadius: 6,
                            border: '1px solid #444',
                            backgroundColor: '#1a1a3e',
                            color: 'white',
                            fontSize: '12px',
                            outline: 'none'
                        }}
                    />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: '11px', color: '#c9cff8' }}>API Base URL</label>
                    <input
                        type="text"
                        value={apiBase}
                        onChange={(e) => setApiBase(e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        style={{
                            padding: '8px',
                            borderRadius: 6,
                            border: '1px solid #444',
                            backgroundColor: '#1a1a3e',
                            color: 'white',
                            fontSize: '12px',
                            outline: 'none'
                        }}
                    />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: '11px', color: '#c9cff8' }}>사용할 LLM 모델</label>
                    <select
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        style={{
                            padding: '8px',
                            borderRadius: 6,
                            border: '1px solid #444',
                            backgroundColor: '#1a1a3e',
                            color: 'white',
                            fontSize: '12px',
                            outline: 'none'
                        }}
                    >
                        <option value="gpt-4o-mini">gpt-4o-mini</option>
                        <option value="gpt-4o">gpt-4o</option>
                        <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                    </select>
                </div>

                <button
                    type="submit"
                    style={{
                        padding: '8px',
                        borderRadius: 6,
                        border: 'none',
                        backgroundColor: '#00b894',
                        color: 'white',
                        cursor: 'pointer',
                        fontSize: '12px',
                        fontWeight: 'bold',
                        marginTop: 4
                    }}
                >
                    💾 설정 적용
                </button>

                {status && (
                    <div style={{ fontSize: '10px', color: '#ffd6a5', textAlign: 'center', marginTop: 4 }}>
                        {status}
                    </div>
                )}
            </form>
        </FloatingPanel>
    );
}
