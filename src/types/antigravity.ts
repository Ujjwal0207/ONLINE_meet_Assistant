export interface AntigravityConfig {
    enabled: boolean;
    path: string;
    model: string;
    timeoutMs: number;
}

export interface AntigravityStatus {
    installed: boolean;
    resolvedPath?: string;
    version?: string;
    error?: string;
}

export interface AntigravityConfigResult {
    success: boolean;
    config?: AntigravityConfig;
    error?: string;
}

export interface AntigravityTestResult {
    success: boolean;
    response?: string;
    error?: string;
}

export const DEFAULT_ANTIGRAVITY_CONFIG: AntigravityConfig = {
    enabled: false,
    path: 'agy',
    model: '',
    timeoutMs: 120000,
};
