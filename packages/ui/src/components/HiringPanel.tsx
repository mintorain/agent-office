import React, { useState, useEffect } from 'react';
import { getColyseusRoom } from '../game/Game';
import { FloatingPanel } from './FloatingPanel';

interface Preset {
    id: string;
    isCustom?: boolean;
    name: string;
    role: string;
    systemPrompt: string;
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
    communicationStyle: 'formal' | 'casual' | 'technical' | 'creative';
    caps: {
        code_execute: boolean;
        web_search: boolean;
        write_note: boolean;
        create_task: boolean;
    };
}

// 1. 대표적인 기본 업무분장 템플릿
const DEFAULT_PRESETS: Preset[] = [
    {
        id: 'preset_pm',
        name: '기획자 (PM)',
        role: 'PM',
        systemPrompt: '당신은 두온교육 사무실의 기획자(PM)입니다. 팀의 전체적인 프로젝트 방향성을 설계하고, 각 사원들에게 명확한 태스크를 할당(create_task)하며, 일정이 지연되지 않도록 유기적으로 소통합니다. 질문에 성실히 답하고 정중하게 팀워크를 이끕니다.',
        openness: 0.8,
        conscientiousness: 0.9,
        extraversion: 0.8,
        agreeableness: 0.8,
        neuroticism: 0.2,
        communicationStyle: 'formal',
        caps: {
            code_execute: false,
            web_search: true,
            write_note: true,
            create_task: true
        }
    },
    {
        id: 'preset_developer',
        name: '개발자 (Developer)',
        role: '엔지니어',
        systemPrompt: '당신은 두온교육 사무실의 핵심 개발자입니다. 주어진 업무를 분석하여 완벽하게 작동하는 코드를 작성하고 문제를 해결하는 역할을 맡고 있습니다. 전문적인 용어와 논리를 활용하여 정확하게 의견을 기술합니다.',
        openness: 0.9,
        conscientiousness: 0.9,
        extraversion: 0.4,
        agreeableness: 0.7,
        neuroticism: 0.3,
        communicationStyle: 'technical',
        caps: {
            code_execute: true,
            web_search: true,
            write_note: true,
            create_task: false
        }
    },
    {
        id: 'preset_designer',
        name: '디자이너 (Designer)',
        role: '디자이너',
        systemPrompt: '당신은 두온교육 사무실의 UI/UX 디자이너입니다. 사용자가 감탄할 수 있는 미려한 디자인을 기획하고 창의적인 영감을 나눕니다. 표현이 풍부하고 감성적인 어조로 동료들과 소통합니다.',
        openness: 0.9,
        conscientiousness: 0.7,
        extraversion: 0.6,
        agreeableness: 0.8,
        neuroticism: 0.3,
        communicationStyle: 'creative',
        caps: {
            code_execute: false,
            web_search: true,
            write_note: true,
            create_task: false
        }
    },
    {
        id: 'preset_marketer',
        name: '마케터 (Marketer)',
        role: '마케터',
        systemPrompt: '당신은 두온교육 사무실의 마케팅 전문가입니다. 대외 홍보 방안을 고민하고 트렌드를 민첩하게 분석해 브랜딩을 강화합니다. 매우 친근하고 활발하며, 동료들에게 적극적으로 인사를 건네고 분위기를 띄웁니다.',
        openness: 0.8,
        conscientiousness: 0.7,
        extraversion: 0.9,
        agreeableness: 0.9,
        neuroticism: 0.2,
        communicationStyle: 'casual',
        caps: {
            code_execute: false,
            web_search: true,
            write_note: true,
            create_task: true
        }
    }
];

interface HiringPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export function HiringPanel({ isOpen, onClose }: HiringPanelProps) {
    const [name, setName] = useState('');
    const [role, setRole] = useState('엔지니어');
    const [systemPrompt, setSystemPrompt] = useState('');
    
    // 성격 (Big Five Traits)
    const [openness, setOpenness] = useState(0.8);
    const [conscientiousness, setConscientiousness] = useState(0.9);
    const [extraversion, setExtraversion] = useState(0.7);
    const [agreeableness, setAgreeableness] = useState(0.8);
    const [neuroticism, setNeuroticism] = useState(0.2);
    
    // 소통 스타일
    const [communicationStyle, setCommunicationStyle] = useState<'formal' | 'casual' | 'technical' | 'creative'>('casual');
    
    // 업무 권한 (Capabilities)
    const [caps, setCaps] = useState({
        code_execute: true,
        web_search: true,
        write_note: true,
        create_task: true
    });

    // 상세 LLM 설정
    const [useCustomLLM, setUseCustomLLM] = useState(false);
    const [provider, setProvider] = useState<'openai' | 'ollama'>('openai');
    const [model, setModel] = useState('gpt-4o-mini');
    const [apiBase, setApiBase] = useState('https://api.openai.com/v1');
    const [apiKey, setApiKey] = useState('');

    // 프리셋 시스템 상태
    const [selectedPresetId, setSelectedPresetId] = useState('');
    const [customPresets, setCustomPresets] = useState<Preset[]>([]);
    const [newPresetName, setNewPresetName] = useState('');
    
    const [status, setStatus] = useState('');

    // 컴포넌트 마운트 시 localStorage에서 사용자 프리셋 로드
    useEffect(() => {
        try {
            const raw = localStorage.getItem('setting:userHiringPresets');
            if (raw) {
                setCustomPresets(JSON.parse(raw));
            }
        } catch (e) {
            console.error('사용자 채용 프리셋 로드 실패:', e);
        }
    }, []);

    if (!isOpen) return null;

    // 모든 프리셋 리스트 (기본 + 사용자 정의)
    const allPresets = [...DEFAULT_PRESETS, ...customPresets];

    const handleCheckboxChange = (key: keyof typeof caps) => {
        setCaps(prev => ({
            ...prev,
            [key]: !prev[key]
        }));
    };

    // 프리셋 로드 처리
    const handlePresetChange = (presetId: string) => {
        setSelectedPresetId(presetId);
        if (!presetId) return;

        const target = allPresets.find(p => p.id === presetId);
        if (target) {
            setRole(target.role);
            setSystemPrompt(target.systemPrompt);
            setOpenness(target.openness);
            setConscientiousness(target.conscientiousness);
            setExtraversion(target.extraversion);
            setAgreeableness(target.agreeableness);
            setNeuroticism(target.neuroticism);
            setCommunicationStyle(target.communicationStyle);
            setCaps({ ...target.caps });
            setStatus(`💡 '${target.name}' 설정을 불러왔습니다.`);
            setTimeout(() => setStatus(''), 2000);
        }
    };

    // 현재 설정을 사용자 프리셋으로 저장
    const handleSavePreset = () => {
        if (!newPresetName.trim()) {
            setStatus('저장할 프리셋 이름을 입력해주세요.');
            return;
        }

        const newPreset: Preset = {
            id: `custom_${Date.now()}`,
            isCustom: true,
            name: newPresetName.trim(),
            role,
            systemPrompt,
            openness,
            conscientiousness,
            extraversion,
            agreeableness,
            neuroticism,
            communicationStyle,
            caps: { ...caps }
        };

        const updatedPresets = [...customPresets, newPreset];
        setCustomPresets(updatedPresets);
        localStorage.setItem('setting:userHiringPresets', JSON.stringify(updatedPresets));
        setSelectedPresetId(newPreset.id);
        setNewPresetName('');
        setStatus(`💾 프리셋 '${newPreset.name}' 저장 완료!`);
        setTimeout(() => setStatus(''), 2000);
    };

    // 사용자 프리셋 삭제
    const handleDeletePreset = (presetId: string, event: React.MouseEvent) => {
        event.stopPropagation();
        const target = customPresets.find(p => p.id === presetId);
        if (!target) return;

        const confirmDelete = window.confirm(`프리셋 '${target.name}'을 삭제하시겠습니까?`);
        if (!confirmDelete) return;

        const updatedPresets = customPresets.filter(p => p.id !== presetId);
        setCustomPresets(updatedPresets);
        localStorage.setItem('setting:userHiringPresets', JSON.stringify(updatedPresets));
        
        if (selectedPresetId === presetId) {
            setSelectedPresetId('');
        }
        setStatus(`🗑️ 프리셋 '${target.name}' 삭제 완료!`);
        setTimeout(() => setStatus(''), 2000);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!name.trim()) {
            setStatus('에이전트 이름을 입력해주세요.');
            return;
        }
        if (!role.trim()) {
            setStatus('전문분야(역할)를 입력해주세요.');
            return;
        }

        const room = getColyseusRoom();
        if (!room) {
            setStatus('오류: 서버 연결이 끊겼습니다.');
            return;
        }

        const messageData: any = {
            name: name.trim(),
            role: role.trim(),
            systemPrompt: systemPrompt.trim() || undefined,
            personality: {
                traits: {
                    openness,
                    conscientiousness,
                    extraversion,
                    agreeableness,
                    neuroticism
                },
                communicationStyle,
                workHours: { start: '09:00', end: '17:00' },
                breakFrequency: 90
            },
            capabilities: caps
        };

        if (useCustomLLM) {
            messageData.llm = {
                provider,
                model: model.trim() || (provider === 'openai' ? 'gpt-4o-mini' : 'llama3.2:latest'),
                apiBase: apiBase.trim() || undefined,
                apiKey: apiKey.trim() || undefined
            };
        }

        room.send('user-hire-agent', messageData);
        setStatus(`🎉 ${name}님 채용 요청을 보냈습니다!`);
        
        setName('');
        setSystemPrompt('');
        setSelectedPresetId('');
        setTimeout(() => {
            setStatus('');
            onClose();
        }, 2000);
    };

    const selectedPreset = allPresets.find(p => p.id === selectedPresetId);

    return (
        <FloatingPanel
            id="hiring-panel"
            title="👥 신규 직원 채용"
            subtitle="새로운 AI 직원의 성격과 전문분야 설정"
            width={340}
            defaultDock="right"
            defaultY={100}
            zIndex={25}
        >
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
                <button
                    onClick={onClose}
                    style={{
                        background: 'rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#aaa',
                        cursor: 'pointer',
                        fontSize: '11px',
                        borderRadius: 4,
                        padding: '3px 8px',
                        transition: 'all 0.2s'
                    }}
                >
                    닫기
                </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '68vh', overflowY: 'auto', paddingRight: 6 }}>
                
                {/* 프리셋 로드 섹션 */}
                <div style={{ border: '1px solid rgba(108,92,231,0.3)', borderRadius: 8, padding: 10, backgroundColor: 'rgba(108,92,231,0.08)' }}>
                    <div style={{ fontSize: '11px', color: '#c9cff8', fontWeight: 'bold', marginBottom: 6 }}>
                        📁 업무분장 템플릿 (기본 및 프리셋)
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <select
                            value={selectedPresetId}
                            onChange={(e) => handlePresetChange(e.target.value)}
                            style={{
                                flex: 1,
                                padding: '6px 8px',
                                borderRadius: 6,
                                border: '1px solid #444',
                                backgroundColor: '#1a1a3e',
                                color: 'white',
                                fontSize: '11px',
                                outline: 'none'
                            }}
                        >
                            <option value="">-- 불러올 템플릿 선택 --</option>
                            <optgroup label="기본 업무분장 템플릿">
                                {DEFAULT_PRESETS.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </optgroup>
                            {customPresets.length > 0 && (
                                <optgroup label="사용자 저장 프리셋">
                                    {customPresets.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </optgroup>
                            )}
                        </select>
                        {selectedPreset && selectedPreset.isCustom && (
                            <button
                                type="button"
                                onClick={(e) => handleDeletePreset(selectedPreset.id, e)}
                                title="이 프리셋 삭제"
                                style={{
                                    background: 'rgba(255, 121, 121, 0.2)',
                                    border: '1px solid rgba(255, 121, 121, 0.4)',
                                    color: '#ff7979',
                                    borderRadius: 6,
                                    padding: '6px 10px',
                                    cursor: 'pointer',
                                    fontSize: '11px'
                                }}
                            >
                                삭제
                            </button>
                        )}
                    </div>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    
                    {/* 기본 정보 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: '11px', color: '#c9cff8', fontWeight: 'bold' }}>직원 이름</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="예: 지태, 파피"
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
                        <label style={{ fontSize: '11px', color: '#c9cff8', fontWeight: 'bold' }}>전문분야 (역할)</label>
                        <input
                            type="text"
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            placeholder="예: 백엔드 개발자, PM, 디자이너"
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

                    {/* 성격 설정 (Big Five) */}
                    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 10, backgroundColor: 'rgba(0,0,0,0.2)' }}>
                        <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold', marginBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4 }}>
                            🧠 에이전트 성격 설정 (Big Five)
                        </div>
                        
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#c9cff8' }}>
                                <span>개방성 (Openness): {openness.toFixed(1)}</span>
                            </div>
                            <input type="range" min="0" max="1" step="0.1" value={openness} onChange={(e) => setOpenness(parseFloat(e.target.value))} style={{ accentColor: '#6c5ce7' }} />
                            
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#c9cff8', marginTop: 4 }}>
                                <span>성실성 (Conscientiousness): {conscientiousness.toFixed(1)}</span>
                            </div>
                            <input type="range" min="0" max="1" step="0.1" value={conscientiousness} onChange={(e) => setConscientiousness(parseFloat(e.target.value))} style={{ accentColor: '#6c5ce7' }} />

                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#c9cff8', marginTop: 4 }}>
                                <span>외향성 (Extraversion): {extraversion.toFixed(1)}</span>
                            </div>
                            <input type="range" min="0" max="1" step="0.1" value={extraversion} onChange={(e) => setExtraversion(parseFloat(e.target.value))} style={{ accentColor: '#6c5ce7' }} />

                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#c9cff8', marginTop: 4 }}>
                                <span>친화성 (Agreeableness): {agreeableness.toFixed(1)}</span>
                            </div>
                            <input type="range" min="0" max="1" step="0.1" value={agreeableness} onChange={(e) => setAgreeableness(parseFloat(e.target.value))} style={{ accentColor: '#6c5ce7' }} />

                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#c9cff8', marginTop: 4 }}>
                                <span>신경증 (Neuroticism): {neuroticism.toFixed(1)}</span>
                            </div>
                            <input type="range" min="0" max="1" step="0.1" value={neuroticism} onChange={(e) => setNeuroticism(parseFloat(e.target.value))} style={{ accentColor: '#6c5ce7' }} />
                        </div>
                    </div>

                    {/* 소통 스타일 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: '11px', color: '#c9cff8', fontWeight: 'bold' }}>소통 스타일</label>
                        <select
                            value={communicationStyle}
                            onChange={(e) => setCommunicationStyle(e.target.value as any)}
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
                            <option value="casual">친근하고 편안함 (Casual)</option>
                            <option value="formal">예의 바르고 격식 있음 (Formal)</option>
                            <option value="technical">기술적이고 구체적임 (Technical)</option>
                            <option value="creative">창의적이고 감성적임 (Creative)</option>
                        </select>
                    </div>

                    {/* 업무 기능 설정 (Capabilities) */}
                    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 10, backgroundColor: 'rgba(0,0,0,0.2)' }}>
                        <div style={{ fontSize: '11px', color: '#fff', fontWeight: 'bold', marginBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4 }}>
                            🛠️ 허용할 업무 기능 (Capabilities)
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11px', color: '#c9cff8', cursor: 'pointer' }}>
                                <input type="checkbox" checked={caps.create_task} onChange={() => handleCheckboxChange('create_task')} />
                                업무 할당 (협업)
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11px', color: '#c9cff8', cursor: 'pointer' }}>
                                <input type="checkbox" checked={caps.code_execute} onChange={() => handleCheckboxChange('code_execute')} />
                                코드 실행
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11px', color: '#c9cff8', cursor: 'pointer' }}>
                                <input type="checkbox" checked={caps.web_search} onChange={() => handleCheckboxChange('web_search')} />
                                웹 검색
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11px', color: '#c9cff8', cursor: 'pointer' }}>
                                <input type="checkbox" checked={caps.write_note} onChange={() => handleCheckboxChange('write_note')} />
                                메모 작성
                            </label>
                        </div>
                    </div>

                    {/* 시스템 프롬프트 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: '11px', color: '#c9cff8', fontWeight: 'bold' }}>시스템 프롬프트 (페르소나)</label>
                        <textarea
                            value={systemPrompt}
                            onChange={(e) => setSystemPrompt(e.target.value)}
                            placeholder="에이전트의 행동 가이드라인을 작성해주세요. (비워둘 시 기본값 적용)"
                            rows={3}
                            style={{
                                padding: '8px',
                                borderRadius: 6,
                                border: '1px solid #444',
                                backgroundColor: '#1a1a3e',
                                color: 'white',
                                fontSize: '11px',
                                outline: 'none',
                                resize: 'none',
                                fontFamily: 'inherit'
                            }}
                        />
                    </div>

                    {/* 프리셋 저장 섹션 */}
                    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 10, backgroundColor: 'rgba(255,255,255,0.02)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontSize: '10px', color: '#aaa', fontWeight: 'bold' }}>
                            💾 현재 설정을 커스텀 프리셋으로 저장
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                            <input
                                type="text"
                                value={newPresetName}
                                onChange={(e) => setNewPresetName(e.target.value)}
                                placeholder="프리셋 이름 (예: 연구원)"
                                style={{
                                    flex: 1,
                                    padding: '5px 8px',
                                    borderRadius: 4,
                                    border: '1px solid #444',
                                    backgroundColor: '#1a1a3e',
                                    color: 'white',
                                    fontSize: '11px',
                                    outline: 'none'
                                }}
                            />
                            <button
                                type="button"
                                onClick={handleSavePreset}
                                style={{
                                    padding: '5px 10px',
                                    borderRadius: 4,
                                    border: 'none',
                                    backgroundColor: '#00b894',
                                    color: 'white',
                                    fontSize: '11px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer'
                                }}
                            >
                                저장
                            </button>
                        </div>
                    </div>

                    {/* 개별 LLM 설정 */}
                    <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, overflow: 'hidden' }}>
                        <button
                            type="button"
                            onClick={() => setUseCustomLLM(!useCustomLLM)}
                            style={{
                                width: '100%',
                                padding: '8px 10px',
                                backgroundColor: 'rgba(255,255,255,0.05)',
                                border: 'none',
                                color: '#c9cff8',
                                textAlign: 'left',
                                fontSize: '11px',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center'
                            }}
                        >
                            <span>🤖 개별 LLM 엔진 설정 (외부 연동)</span>
                            <span>{useCustomLLM ? '▼' : '▶'}</span>
                        </button>
                        
                        {useCustomLLM && (
                            <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, backgroundColor: 'rgba(0,0,0,0.15)' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <label style={{ fontSize: '10px', color: '#aaa' }}>Provider</label>
                                    <select
                                        value={provider}
                                        onChange={(e) => setProvider(e.target.value as any)}
                                        style={{
                                            padding: '6px',
                                            borderRadius: 4,
                                            border: '1px solid #444',
                                            backgroundColor: '#1a1a3e',
                                            color: 'white',
                                            fontSize: '11px'
                                        }}
                                    >
                                        <option value="openai">OpenAI (또는 호환 API)</option>
                                        <option value="ollama">Ollama (로컬 API)</option>
                                    </select>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <label style={{ fontSize: '10px', color: '#aaa' }}>Model Name</label>
                                    <input
                                        type="text"
                                        value={model}
                                        onChange={(e) => setModel(e.target.value)}
                                        placeholder={provider === 'openai' ? 'gpt-4o-mini' : 'llama3.2:latest'}
                                        style={{
                                            padding: '6px',
                                            borderRadius: 4,
                                            border: '1px solid #444',
                                            backgroundColor: '#1a1a3e',
                                            color: 'white',
                                            fontSize: '11px'
                                        }}
                                    />
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <label style={{ fontSize: '10px', color: '#aaa' }}>API Base URL</label>
                                    <input
                                        type="text"
                                        value={apiBase}
                                        onChange={(e) => setApiBase(e.target.value)}
                                        placeholder={provider === 'openai' ? 'https://api.openai.com/v1' : 'http://localhost:11434'}
                                        style={{
                                            padding: '6px',
                                            borderRadius: 4,
                                            border: '1px solid #444',
                                            backgroundColor: '#1a1a3e',
                                            color: 'white',
                                            fontSize: '11px'
                                        }}
                                    />
                                </div>

                                {provider === 'openai' && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        <label style={{ fontSize: '10px', color: '#aaa' }}>API Key</label>
                                        <input
                                            type="password"
                                            value={apiKey}
                                            onChange={(e) => setApiKey(e.target.value)}
                                            placeholder="sk-..."
                                            style={{
                                                padding: '6px',
                                                borderRadius: 4,
                                                border: '1px solid #444',
                                                backgroundColor: '#1a1a3e',
                                                color: 'white',
                                                fontSize: '11px'
                                            }}
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <button
                        type="submit"
                        style={{
                            padding: '10px',
                            borderRadius: 6,
                            border: 'none',
                            backgroundColor: '#6c5ce7',
                            color: 'white',
                            cursor: 'pointer',
                            fontSize: '13px',
                            fontWeight: 'bold',
                            marginTop: 4,
                            boxShadow: '0 4px 12px rgba(108,92,231,0.3)',
                            transition: 'all 0.2s'
                        }}
                    >
                        🤝 채용 적용
                    </button>

                    {status && (
                        <div style={{ fontSize: '11px', color: '#ffd6a5', textAlign: 'center', marginTop: 4 }}>
                            {status}
                        </div>
                    )}
                </form>
            </div>
        </FloatingPanel>
    );
}
