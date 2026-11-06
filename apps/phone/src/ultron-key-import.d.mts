import type { CloudProviderId } from "./cloud-llm";

export declare function providerFromKeyFilename(filename: string): CloudProviderId | null;
export declare function parseProviderKeyFile(contents: string): string[];
export declare function validateProviderKeyFiles(files: readonly { name: string; size: number }[]): string | null;
