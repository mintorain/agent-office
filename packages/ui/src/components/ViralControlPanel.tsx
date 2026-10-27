import React, { useEffect, useState } from 'react';
import { getColyseusRoom } from '../game/Game';
import { eventBus } from '../events';
import { FloatingPanel } from './FloatingPanel';

const SCENARIOS = ['스타트업 위기 상황', '해커톤 밤샘 작업', '장애 대응 워룸', '신제품 런칭'] as const;
const CHAOS_EVENTS = [
    { id: 'server_outage', label: '서버 마비' },
    { id: 'funding_cut', label: '자금 삭감' },
    { id: 'client_escalation', label: '고객 클레임' },
    { id: 'surprise_launch', label: '기습 출시' },
    { id: 'viral_tweet', label: '트윗 바이럴' },
] as const;

export function ViralControlPanel() {
    const [scenario, setScenario] = useState<string>(SCENARIOS[0]);
    const [cinematicMode, setCinematicMode] = useState(true);
    const [lastEvent, setLastEvent] = useState('대기 중');
    const [voteStatus, setVoteStatus] = useState('');

    useEffect(() => {
        eventBus.dispatchEvent(new CustomEvent('cinematic-toggle', { detail: { enabled: cinematicMode } }));
    }, [cinematicMode]);

    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.label) {
                setLastEvent(detail.label);
            } else if (detail?.scenario) {
                setLastEvent(`시나리오: ${detail.scenario}`);
            }
        };
        eventBus.addEventListener('scenario-event', handler);
        return () => eventBus.removeEventListener('scenario-event', handler);
    }, []);

    const startScenario = () => {
        const room = getColyseusRoom();
        if (!room) return;
        room.send('start-scenario', { scenario });
    };

    const triggerChaos = (eventId: string) => {
        const room = getColyseusRoom();
        if (!room) return;
        room.send('trigger-chaos', { event: eventId });
    };

    const castVote = async (eventId: string) => {
        try {
            const response = await fetch('/api/vote-chaos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    event: eventId,
                    voterId: `local-${Math.random().toString(36).slice(2, 8)}`
                })
            });
            const data = await response.json();
            if (data?.ok) {
                setVoteStatus(`${eventId}: ${data.tally}표${data.triggered ? ' (유발됨!)' : ''}`);
            } else {
                setVoteStatus('투표 실패');
            }
        } catch {
            setVoteStatus('투표 실패');
        }
    };

    return (
        <FloatingPanel
            id="viral-control"
            title="시나리오 및 카오스 통제"
            subtitle="바이럴 모드 제어 콘솔"
            width={330}
            defaultDock="right"
            defaultY={20}
            zIndex={18}
        >
            <div style={{ fontSize: 11, color: '#babedc', marginTop: 8, marginBottom: 10 }}>
                최근 이벤트: <strong style={{ color: '#ffd6a5' }}>{lastEvent}</strong>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <select
                    value={scenario}
                    onChange={(e) => setScenario(e.target.value)}
                    style={{
                        flex: 1,
                        background: '#181f45',
                        color: '#fff',
                        borderRadius: 8,
                        border: '1px solid rgba(255,255,255,0.2)',
                        padding: '8px 10px',
                        fontSize: 12
                    }}
                >
                    {SCENARIOS.map((item) => (
                        <option key={item} value={item}>{item}</option>
                    ))}
                </select>
                <button
                    onClick={startScenario}
                    style={{
                        border: 'none',
                        borderRadius: 8,
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontWeight: 700,
                        color: '#150f21',
                        background: 'linear-gradient(135deg, #ffadad, #ffd6a5)'
                    }}
                >
                    시작
                </button>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 10 }}>
                <input
                    type="checkbox"
                    checked={cinematicMode}
                    onChange={(e) => setCinematicMode(e.target.checked)}
                />
                시네마틱 카메라 자동 포커스
            </label>

            <div style={{ fontSize: 12, marginBottom: 6, color: '#ffcad4' }}>카오스 유발 버튼</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {CHAOS_EVENTS.map((event) => (
                    <div key={event.id} style={{ display: 'flex', gap: 4 }}>
                        <button
                            onClick={() => triggerChaos(event.id)}
                            style={{
                                flex: 1,
                                border: '1px solid rgba(255,255,255,0.12)',
                                background: 'rgba(255,255,255,0.06)',
                                color: '#f0f3ff',
                                borderRadius: 8,
                                padding: '7px 8px',
                                cursor: 'pointer',
                                fontSize: 11
                            }}
                        >
                            {event.label}
                        </button>
                        <button
                            onClick={() => castVote(event.id)}
                            title="Audience vote"
                            style={{
                                border: '1px solid rgba(255,255,255,0.12)',
                                background: 'rgba(255, 214, 165, 0.2)',
                                color: '#ffe5c2',
                                borderRadius: 8,
                                padding: '7px 8px',
                                cursor: 'pointer',
                                fontSize: 11
                            }}
                        >
                            투표
                        </button>
                    </div>
                ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: '#ffd6a5', minHeight: 16 }}>
                {voteStatus}
            </div>
        </FloatingPanel>
    );
}
