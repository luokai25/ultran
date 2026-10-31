package app.ultran.mobile;

final class NativeLlama {
    static {
        System.loadLibrary("ultran-llama");
    }

    private NativeLlama() {}

    static native String nativeVersion();
    static native String nativeLoadModel(String path, int contextTokens, boolean aggressiveLazyLoading);
    static native String nativeGenerate(String[] roles, String[] contents, int maxTokens);
    static native String nativeGetLastMetrics();
    static native void nativeUnloadModel();
}
