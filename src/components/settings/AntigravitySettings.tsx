import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, ExternalLink, Loader2 } from 'lucide-react';
import type { AntigravityConfig, AntigravityStatus } from '../../types/antigravity';
import { ANTIGRAVITY_MODEL } from '../../utils/modelUtils';
import { useT } from '../../i18n';

interface AntigravitySettingsProps {
    config: AntigravityConfig;
    onConfigChange: (config: AntigravityConfig) => void;
    onSelected: () => void;
}

export const AntigravitySettings: React.FC<AntigravitySettingsProps> = ({ config, onConfigChange, onSelected }) => {
    const t = useT();
    const [draft, setDraft] = useState(config);
    const [status, setStatus] = useState<AntigravityStatus | null>(null);
    const [busy, setBusy] = useState<'save' | 'check' | 'test' | 'select' | null>(null);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [testResponse, setTestResponse] = useState('');

    useEffect(() => setDraft(config), [config]);

    useEffect(() => {
        let cancelled = false;
        window.electronAPI?.getAntigravityStatus?.()
            .then(result => { if (!cancelled) setStatus(result); })
            .catch(() => { /* The explicit check displays actionable failures. */ });
        return () => { cancelled = true; };
    }, [config.path]);

    const save = async (next = draft): Promise<AntigravityConfig> => {
        const result = await window.electronAPI.setAntigravityConfig({
            ...next,
            path: next.path.trim() || 'agy',
            model: next.model.trim(),
        });
        if (!result.success || !result.config) throw new Error(result.error || t('Could not save Antigravity settings.'));
        setDraft(result.config);
        onConfigChange(result.config);
        return result.config;
    };

    const run = async (action: NonNullable<typeof busy>, next = draft) => {
        setBusy(action);
        setMessage('');
        setError('');
        setTestResponse('');
        try {
            const saved = await save(action === 'select' ? { ...next, enabled: true } : next);
            if (action === 'check') {
                const result = await window.electronAPI.getAntigravityStatus();
                setStatus(result);
                if (!result.installed) throw new Error(result.error || t('Antigravity CLI was not found. Follow the setup instructions, then check again.'));
                setMessage(t('CLI found. Send a test request to check your account access.'));
            } else if (action === 'test') {
                const result = await window.electronAPI.testAntigravity(saved);
                if (!result.success) throw new Error(result.error || t('Antigravity did not return an answer.'));
                setMessage(t('Antigravity returned an answer.'));
                setTestResponse(result.response || '');
            } else if (action === 'select') {
                const result = await window.electronAPI.setDefaultModel(ANTIGRAVITY_MODEL.id);
                if (!result.success) throw new Error(result.error || t('Could not select Antigravity.'));
                onSelected();
                setMessage(t('Antigravity is now your active model.'));
            } else {
                setMessage(t('Antigravity settings saved.'));
            }
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('Antigravity request failed.'));
        } finally {
            setBusy(null);
        }
    };

    const buttonClass = 'px-3 py-2 rounded-lg border border-border-subtle bg-bg-input hover:bg-bg-elevated text-xs text-text-primary disabled:opacity-50 flex items-center gap-1.5';

    return (
        <section className="bg-bg-item-surface rounded-xl p-5 border border-border-subtle space-y-4" aria-label="Antigravity settings">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-sm font-bold text-text-primary">Antigravity</h3>
                    <p className="text-xs text-text-secondary mt-1">
                        {t('Send questions to your Antigravity account and show its answers here using the official Antigravity CLI.')}
                    </p>
                </div>
                <button
                    type="button"
                    role="switch"
                    aria-label={t('Enable Antigravity')}
                    aria-checked={draft.enabled}
                    disabled={!!busy}
                    onClick={() => void run('save', { ...draft, enabled: !draft.enabled })}
                    className={`shrink-0 w-11 h-6 rounded-full relative transition-colors disabled:opacity-50 ${draft.enabled ? 'bg-accent-primary' : 'bg-bg-toggle-switch border border-border-muted'}`}
                >
                    <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${draft.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
            </div>

            <p className="text-xs text-text-secondary">
                {t('Install the official CLI, then run agy in Terminal and complete Google sign-in with your Antigravity account. This uses the same Antigravity service; it does not control the desktop chat window.')}
            </p>
            <button
                type="button"
                className="text-xs text-accent-primary hover:underline flex items-center gap-1"
                onClick={() => void window.electronAPI.openExternal('https://antigravity.google/docs/getting-started?tab=cli').catch(() => setError(t('Could not open the setup instructions.')))}
            >
                {t('Setup and sign-in instructions')} <ExternalLink size={12} />
            </button>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                    <span className="block text-xs text-text-secondary">{t('CLI executable')}</span>
                    <input
                        value={draft.path}
                        disabled={!!busy}
                        onChange={event => { setDraft(previous => ({ ...previous, path: event.target.value })); setStatus(null); }}
                        placeholder="agy"
                        spellCheck={false}
                        className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary"
                    />
                </label>
                <label className="space-y-1">
                    <span className="block text-xs text-text-secondary">{t('Model ID (optional)')}</span>
                    <input
                        value={draft.model}
                        list="antigravity-model-suggestions"
                        disabled={!!busy}
                        onChange={event => setDraft(previous => ({ ...previous, model: event.target.value }))}
                        placeholder={t('Antigravity default')}
                        spellCheck={false}
                        className="w-full bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent-primary"
                    />
                    <datalist id="antigravity-model-suggestions">
                        <option value="gemini-3.8-flash-medium">Gemini 3.8 Flash (Medium)</option>
                        <option value="gemini-3.8-flash-low">Gemini 3.8 Flash (Low)</option>
                        <option value="gemini-3.8-flash-high">Gemini 3.8 Flash (High)</option>
                    </datalist>
                </label>
            </div>
            <label className="block space-y-1">
                <span className="block text-xs text-text-secondary">{t('Response timeout (seconds)')}</span>
                <input
                    type="number"
                    min={1}
                    max={600}
                    step={1}
                    value={draft.timeoutMs / 1000}
                    disabled={!!busy}
                    onChange={event => {
                        const seconds = Number(event.target.value);
                        if (Number.isFinite(seconds)) setDraft(previous => ({ ...previous, timeoutMs: Math.min(600, Math.max(1, seconds)) * 1000 }));
                    }}
                    className="w-28 bg-bg-input border border-border-subtle rounded-lg px-3 py-2 text-xs text-text-primary focus:outline-none focus:border-accent-primary"
                />
            </label>
            <p className="text-[11px] text-text-secondary">{t('Leave the model blank to use the CLI default, or enter a model ID available to your account. Test request sends a short prompt to Antigravity and uses your account quota.')}</p>

            {status && (
                <div className="text-xs text-text-secondary break-all">
                    {status.installed
                        ? `${t('CLI installed')}${status.version ? ` (${status.version})` : ''}${status.resolvedPath ? ` · ${status.resolvedPath}` : ''}`
                        : status.error || t('CLI not found. Install it using the setup instructions above.')}
                </div>
            )}

            <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass} disabled={!!busy} onClick={() => void run('save')}>{busy === 'save' && <Loader2 size={12} className="animate-spin" />}{t('Save')}</button>
                <button type="button" className={buttonClass} disabled={!!busy} onClick={() => void run('check')}>{busy === 'check' && <Loader2 size={12} className="animate-spin" />}{t('Check installation')}</button>
                <button type="button" className={buttonClass} disabled={!!busy} onClick={() => void run('test')}>{busy === 'test' && <Loader2 size={12} className="animate-spin" />}{busy === 'test' ? t('Waiting for Antigravity…') : t('Test request')}</button>
                <button type="button" className={`${buttonClass} border-accent-primary text-accent-primary`} disabled={!!busy} onClick={() => void run('select')}>{busy === 'select' && <Loader2 size={12} className="animate-spin" />}{t('Use Antigravity')}</button>
            </div>

            {error && <p role="alert" className="text-xs text-red-400 flex items-start gap-1.5"><AlertCircle size={14} className="shrink-0 mt-0.5" /><span className="whitespace-pre-wrap break-words">{error}</span></p>}
            {message && <p role="status" className="text-xs text-green-500 flex items-start gap-1.5"><CheckCircle size={14} className="shrink-0" />{message}</p>}
            {testResponse && <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words text-xs text-text-primary bg-bg-input p-3 rounded-lg">{testResponse}</pre>}
        </section>
    );
};
