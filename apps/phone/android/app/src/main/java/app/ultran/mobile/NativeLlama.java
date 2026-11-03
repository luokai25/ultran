package app.ultran.mobile;

final class NativeLlama {
    static {
        System.loadLibrary("ultran-llama");
    }

    private NativeLlama() {}

    static native String nativeVersion();
    static native String nativeLoadModel(String path, int contextTokens, boolean aggressiveLazyLoading);
    interface TokenCallback { void onToken(String token); }
    static native String nativeGenerate(String[] roles, String[] contents, int maxTokens, TokenCallback callback);
    static native void nativeCancelGeneration();
    static native void nativeResetGenerationCancellation();
    static native String nativeGetLastMetrics();
    static native void nativeUnloadModel();
}
