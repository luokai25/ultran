package app.ultron.mobile;

final class NativeLlama {
    static {
        System.loadLibrary("ultron-llama");
    }

    private NativeLlama() {}

    static native String nativeVersion();
    static native String nativeLoadModel(String path, String projectorPath, int contextTokens, boolean aggressiveLazyLoading);
    interface TokenCallback { void onToken(String token); }
    static native String nativeGenerate(String[] roles, String[] contents, byte[][] images, int maxTokens, TokenCallback callback);
    static native void nativeCancelGeneration();
    static native void nativeResetGenerationCancellation();
    static native String nativeGetLastMetrics();
    static native void nativeUnloadModel();
}
