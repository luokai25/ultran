#include <jni.h>
#include <algorithm>
#include <atomic>
#include <cstdint>
#include <chrono>
#include <iomanip>
#include <sstream>
#include <cstddef>
#include <mutex>
#include <memory>
#include <string>
#include <unistd.h>
#include <vector>
#include "llama.h"
#include "mtmd.h"
#include "mtmd-helper.h"

namespace {
std::mutex g_mutex;
std::atomic<bool> g_cancel_requested{false};
llama_model *g_model = nullptr;
llama_context *g_context = nullptr;
mtmd_context *g_mtmd_context = nullptr;
bool g_backend_initialized = false;
uint32_t g_context_tokens = 2048;
uint64_t g_last_prompt_tokens = 0;
uint64_t g_last_generated_tokens = 0;
double g_last_prompt_ms = 0.0;
double g_last_generation_ms = 0.0;

void release_model() {
    if (g_mtmd_context) {
        mtmd_free(g_mtmd_context);
        g_mtmd_context = nullptr;
    }
    if (g_context) {
        llama_free(g_context);
        g_context = nullptr;
    }
    if (g_model) {
        llama_model_free(g_model);
        g_model = nullptr;
    }
}

std::string java_string(JNIEnv *env, jstring value) {
    if (!value) return {};
    const jchar *chars = env->GetStringChars(value, nullptr);
    if (!chars) return {};
    const jsize length = env->GetStringLength(value);
    std::string result;
    result.reserve(static_cast<size_t>(length) * 3);
    for (jsize i = 0; i < length; ++i) {
        uint32_t cp = chars[i];
        if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < length) {
            const uint32_t low = chars[i + 1];
            if (low >= 0xdc00 && low <= 0xdfff) {
                cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
                ++i;
            } else {
                cp = 0xfffd;
            }
        } else if (cp >= 0xdc00 && cp <= 0xdfff) {
            cp = 0xfffd;
        }
        if (cp < 0x80) {
            result.push_back(static_cast<char>(cp));
        } else if (cp < 0x800) {
            result.push_back(static_cast<char>(0xc0 | (cp >> 6)));
            result.push_back(static_cast<char>(0x80 | (cp & 0x3f)));
        } else if (cp < 0x10000) {
            result.push_back(static_cast<char>(0xe0 | (cp >> 12)));
            result.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3f)));
            result.push_back(static_cast<char>(0x80 | (cp & 0x3f)));
        } else {
            result.push_back(static_cast<char>(0xf0 | (cp >> 18)));
            result.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3f)));
            result.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3f)));
            result.push_back(static_cast<char>(0x80 | (cp & 0x3f)));
        }
    }
    env->ReleaseStringChars(value, chars);
    return result;
}

jstring to_java_string(JNIEnv *env, const std::string &value) {
    std::vector<jchar> utf16;
    utf16.reserve(value.size());
    for (size_t i = 0; i < value.size();) {
        const uint8_t lead = static_cast<uint8_t>(value[i]);
        uint32_t codepoint = 0xfffd;
        size_t width = 1;
        if (lead < 0x80) codepoint = lead;
        else if ((lead & 0xe0) == 0xc0 && i + 1 < value.size()) {
            codepoint = ((lead & 0x1f) << 6) | (static_cast<uint8_t>(value[i + 1]) & 0x3f); width = 2;
        } else if ((lead & 0xf0) == 0xe0 && i + 2 < value.size()) {
            codepoint = ((lead & 0x0f) << 12) | ((static_cast<uint8_t>(value[i + 1]) & 0x3f) << 6) |
                        (static_cast<uint8_t>(value[i + 2]) & 0x3f); width = 3;
        } else if ((lead & 0xf8) == 0xf0 && i + 3 < value.size()) {
            codepoint = ((lead & 0x07) << 18) | ((static_cast<uint8_t>(value[i + 1]) & 0x3f) << 12) |
                        ((static_cast<uint8_t>(value[i + 2]) & 0x3f) << 6) |
                        (static_cast<uint8_t>(value[i + 3]) & 0x3f); width = 4;
        }
        i += width;
        if (codepoint <= 0xffff) {
            utf16.push_back(static_cast<jchar>(codepoint));
        } else if (codepoint <= 0x10ffff) {
            codepoint -= 0x10000;
            utf16.push_back(static_cast<jchar>(0xd800 + (codepoint >> 10)));
            utf16.push_back(static_cast<jchar>(0xdc00 + (codepoint & 0x3ff)));
        } else {
            utf16.push_back(static_cast<jchar>(0xfffd));
        }
    }
    return env->NewString(utf16.data(), static_cast<jsize>(utf16.size()));
}

std::string format_chat(const std::vector<std::string> &roles,
                        const std::vector<std::string> &contents) {
    std::vector<llama_chat_message> messages;
    messages.reserve(roles.size());
    for (size_t i = 0; i < roles.size(); ++i) {
        messages.push_back({roles[i].c_str(), contents[i].c_str()});
    }

    const char *tmpl = llama_model_chat_template(g_model, nullptr);
    if (tmpl) {
        size_t capacity = 4096;
        for (const auto &content : contents) capacity += content.size() * 2;
        std::vector<char> buffer(capacity);
        const int32_t required = llama_chat_apply_template(
            tmpl, messages.data(), messages.size(), true, buffer.data(),
            static_cast<int32_t>(buffer.size()));
        if (required > 0 && static_cast<size_t>(required) <= buffer.size()) {
            return std::string(buffer.data(), static_cast<size_t>(required));
        }
    }

    std::string fallback;
    for (size_t i = 0; i < roles.size(); ++i) {
        fallback += "<|";
        fallback += roles[i];
        fallback += "|>\n";
        fallback += contents[i];
        fallback += "\n";
    }
    fallback += "<|assistant|>\n";
    return fallback;
}

std::vector<llama_token> tokenize(const std::string &prompt) {
    const llama_vocab *vocab = llama_model_get_vocab(g_model);
    const int32_t needed = llama_tokenize(
        vocab, prompt.c_str(), static_cast<int32_t>(prompt.size()),
        nullptr, 0, true, true);
    if (needed == INT32_MIN || needed >= 0) return {};
    std::vector<llama_token> tokens(static_cast<size_t>(-needed));
    const int32_t count = llama_tokenize(
        vocab, prompt.c_str(), static_cast<int32_t>(prompt.size()),
        tokens.data(), static_cast<int32_t>(tokens.size()), true, true);
    if (count <= 0) return {};
    tokens.resize(static_cast<size_t>(count));
    return tokens;
}
} // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_app_ultran_mobile_NativeLlama_nativeVersion(JNIEnv *env, jclass) {
    return env->NewStringUTF(llama_version());
}

extern "C" JNIEXPORT jstring JNICALL
Java_app_ultran_mobile_NativeLlama_nativeLoadModel(JNIEnv *env, jclass, jstring jpath, jstring jprojector_path, jint requested_context, jboolean aggressive_lazy_loading) {
    std::lock_guard<std::mutex> lock(g_mutex);
    const std::string path = java_string(env, jpath);
    if (path.empty()) return env->NewStringUTF("Model path is empty.");
    release_model();

    if (!g_backend_initialized) {
        llama_backend_init();
        g_backend_initialized = true;
    }

    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0;
    // File-backed weights keep the full checkpoint out of anonymous RAM.
    // Android's page cache can reclaim clean pages between layer reads.
    model_params.load_mode = LLAMA_LOAD_MODE_MMAP;
    model_params.lazy_mode = aggressive_lazy_loading ? LLAMA_LAZY_MODE_ON : LLAMA_LAZY_MODE_AUTO;
    g_model = llama_model_load_from_file(path.c_str(), model_params);
    if (!g_model) return env->NewStringUTF("Could not load this GGUF model. Check its integrity and available RAM.");

    llama_context_params context_params = llama_context_default_params();
    g_context_tokens = static_cast<uint32_t>(std::max(512, std::min(2048, static_cast<int>(requested_context))));
    context_params.n_ctx = g_context_tokens;
    context_params.n_batch = 64;
    context_params.n_ubatch = 64;
    const long processors = sysconf(_SC_NPROCESSORS_ONLN);
    const int threads = std::max(1, std::min(4, static_cast<int>(processors) - 1));
    context_params.n_threads = threads;
    context_params.n_threads_batch = threads;
    g_context = llama_init_from_model(g_model, context_params);
    if (!g_context) {
        release_model();
        return env->NewStringUTF("The model weights were mapped, but even the reduced context cache could not fit in memory. Close other apps or choose a smaller model.");
    }

    const std::string projector_path = java_string(env, jprojector_path);
    if (!projector_path.empty()) {
        mtmd_context_params mtmd_params = mtmd_context_params_default();
        mtmd_params.use_gpu = false;
        mtmd_params.n_threads = threads;
        mtmd_params.warmup = false;
        g_mtmd_context = mtmd_init_from_file(projector_path.c_str(), g_model, mtmd_params);
        if (!g_mtmd_context) {
            release_model();
            return env->NewStringUTF("The projector could not be loaded with this model. Check that it is a compatible mmproj GGUF file.");
        }
        if (!mtmd_support_vision(g_mtmd_context)) {
            release_model();
            return env->NewStringUTF("This projector does not provide image input for the selected model.");
        }
    }
    return env->NewStringUTF("");
}

extern "C" JNIEXPORT jstring JNICALL
Java_app_ultran_mobile_NativeLlama_nativeGenerate(
    JNIEnv *env, jclass, jobjectArray jroles, jobjectArray jcontents, jobjectArray jimages, jint max_tokens, jobject callback) {
    std::lock_guard<std::mutex> lock(g_mutex);
    if (!g_model || !g_context) return env->NewStringUTF("No native model is loaded.");
    using Clock = std::chrono::steady_clock;
    g_last_prompt_tokens = 0;
    g_last_generated_tokens = 0;
    g_last_prompt_ms = 0.0;
    g_last_generation_ms = 0.0;

    const jsize count = jroles ? env->GetArrayLength(jroles) : 0;
    if (count == 0 || count > 40 || !jcontents || env->GetArrayLength(jcontents) != count) {
        return env->NewStringUTF("Conversation is empty or too long.");
    }

    std::vector<std::string> roles;
    std::vector<std::string> contents;
    roles.reserve(count);
    contents.reserve(count);
    for (jsize i = 0; i < count; ++i) {
        auto jr = static_cast<jstring>(env->GetObjectArrayElement(jroles, i));
        auto jc = static_cast<jstring>(env->GetObjectArrayElement(jcontents, i));
        roles.push_back(java_string(env, jr));
        contents.push_back(java_string(env, jc));
        env->DeleteLocalRef(jr);
        env->DeleteLocalRef(jc);
    }

    const std::string prompt = format_chat(roles, contents);
    std::vector<std::vector<unsigned char>> image_buffers;
    const jsize image_count = jimages ? env->GetArrayLength(jimages) : 0;
    if (image_count > 4) return env->NewStringUTF("On-device vision accepts up to four images in one prompt.");
    const int limit = std::max(16, std::min({512, static_cast<int>(max_tokens), static_cast<int>(g_context_tokens / 2), image_count > 0 ? 128 : 512}));
    const size_t prompt_limit = static_cast<size_t>(g_context_tokens - static_cast<uint32_t>(limit) - 16);
    image_buffers.reserve(static_cast<size_t>(image_count));
    size_t total_image_bytes = 0;
    for (jsize i = 0; i < image_count; ++i) {
        auto image = static_cast<jbyteArray>(env->GetObjectArrayElement(jimages, i));
        if (!image) return env->NewStringUTF("An attached image could not be read.");
        const jsize length = env->GetArrayLength(image);
        if (length <= 0 || length > 2 * 1024 * 1024) {
            env->DeleteLocalRef(image);
            return env->NewStringUTF("An attached image exceeds the 2 MB native vision limit.");
        }
        total_image_bytes += static_cast<size_t>(length);
        if (total_image_bytes > 4 * 1024 * 1024) {
            env->DeleteLocalRef(image);
            return env->NewStringUTF("Attached images exceed the 4 MB combined native vision limit.");
        }
        std::vector<unsigned char> bytes(static_cast<size_t>(length));
        env->GetByteArrayRegion(image, 0, length, reinterpret_cast<jbyte *>(bytes.data()));
        env->DeleteLocalRef(image);
        if (env->ExceptionCheck()) {
            env->ExceptionClear();
            return env->NewStringUTF("An attached image could not be copied into native memory.");
        }
        image_buffers.push_back(std::move(bytes));
    }

    g_last_prompt_tokens = 0;
    g_last_generated_tokens = 0;
    g_last_prompt_ms = 0.0;
    g_last_generation_ms = 0.0;
    const auto prompt_start = Clock::now();
    llama_memory_clear(llama_get_memory(g_context), true);

    if (!image_buffers.empty()) {
        if (!g_mtmd_context || !mtmd_support_vision(g_mtmd_context)) {
            return env->NewStringUTF("Load a compatible vision projector before asking the on-device model to inspect images.");
        }
        std::vector<std::unique_ptr<mtmd_bitmap, decltype(&mtmd_bitmap_free)>> owned_bitmaps;
        std::vector<const mtmd_bitmap *> bitmaps;
        owned_bitmaps.reserve(image_buffers.size());
        bitmaps.reserve(image_buffers.size());
        const mtmd_helper_init_opt bitmap_options = mtmd_helper_init_opt_default();
        for (const auto &bytes : image_buffers) {
            const auto wrapper = mtmd_helper_bitmap_init_from_buf(
                g_mtmd_context, bytes.data(), bytes.size(), false, bitmap_options);
            if (!wrapper.bitmap) {
                return env->NewStringUTF("The native vision engine could not decode an attached image. Use PNG, JPEG, or another supported image format.");
            }
            owned_bitmaps.emplace_back(wrapper.bitmap, mtmd_bitmap_free);
        }
        for (const auto &bitmap : owned_bitmaps) bitmaps.push_back(bitmap.get());

        mtmd_input_text input_text{prompt.c_str(), prompt.size(), true, true};
        std::unique_ptr<mtmd_input_chunks, decltype(&mtmd_input_chunks_free)> chunks(
            mtmd_input_chunks_init(), mtmd_input_chunks_free);
        if (!chunks) return env->NewStringUTF("Could not allocate the native multimodal prompt.");
        const int32_t tokenize_result = mtmd_tokenize(
            g_mtmd_context, chunks.get(), &input_text, bitmaps.data(), bitmaps.size());
        if (tokenize_result != 0) {
            return env->NewStringUTF(tokenize_result == 1
                ? "The image markers did not match the attached images."
                : "The native vision engine could not prepare the attached images.");
        }
        const size_t prompt_tokens = mtmd_helper_get_n_tokens(chunks.get());
        const llama_pos prompt_positions = mtmd_helper_get_n_pos(chunks.get());
        if (prompt_tokens == 0 || prompt_positions <= 0) {
            return env->NewStringUTF("The native vision engine produced an empty prompt.");
        }
        if (static_cast<size_t>(prompt_positions) > prompt_limit) {
            return env->NewStringUTF("The images and conversation exceed this model's available context. Shorten the conversation or attach fewer/smaller images.");
        }
        g_last_prompt_tokens = prompt_tokens;
        llama_pos new_n_past = 0;
        const int32_t eval_result = mtmd_helper_eval_chunks(
            g_mtmd_context, g_context, chunks.get(), 0, 0, 64, true, &new_n_past);
        if (eval_result != 0) {
            return env->NewStringUTF("The on-device model failed while encoding or processing the attached image. Check that the projector matches this model and that enough memory is available.");
        }
    } else {
        auto tokens = tokenize(prompt);
        if (tokens.empty()) return env->NewStringUTF("The model could not tokenize this conversation.");
        if (tokens.size() > prompt_limit) {
            // Preserve the opening system instructions and the newest conversation
            // turns instead of chopping the system prompt off the front.
            const size_t prefix_tokens = std::min<size_t>(256, prompt_limit / 4);
            const size_t suffix_tokens = prompt_limit - prefix_tokens;
            tokens.erase(tokens.begin() + static_cast<ptrdiff_t>(prefix_tokens),
                         tokens.end() - static_cast<ptrdiff_t>(suffix_tokens));
        }
        g_last_prompt_tokens = tokens.size();
        for (size_t offset = 0; offset < tokens.size(); offset += 64) {
            if (g_cancel_requested.load(std::memory_order_acquire)) return env->NewStringUTF("");
            const size_t batch_count = std::min<size_t>(64, tokens.size() - offset);
            llama_batch prompt_batch = llama_batch_get_one(tokens.data() + offset, static_cast<int32_t>(batch_count));
            if (llama_decode(g_context, prompt_batch) != 0) {
                return env->NewStringUTF("The model failed while processing the prompt. Try a shorter conversation.");
            }
        }
    }

    const auto generation_start = Clock::now();
    g_last_prompt_ms = std::chrono::duration<double, std::milli>(generation_start - prompt_start).count();

    auto sampler_params = llama_sampler_chain_default_params();
    llama_sampler *sampler = llama_sampler_chain_init(sampler_params);
    llama_sampler_chain_add(sampler, llama_sampler_init_top_k(40));
    llama_sampler_chain_add(sampler, llama_sampler_init_top_p(0.9f, 1));
    llama_sampler_chain_add(sampler, llama_sampler_init_temp(0.7f));
    llama_sampler_chain_add(sampler, llama_sampler_init_dist(42));

    const llama_vocab *vocab = llama_model_get_vocab(g_model);
    jclass callback_class = callback ? env->GetObjectClass(callback) : nullptr;
    jmethodID on_token = callback_class ? env->GetMethodID(callback_class, "onToken", "(Ljava/lang/String;)V") : nullptr;
    std::string output;
    for (int i = 0; i < limit; ++i) {
        if (g_cancel_requested.load(std::memory_order_acquire)) break;
        const llama_token token = llama_sampler_sample(sampler, g_context, -1);
        llama_sampler_accept(sampler, token);
        if (llama_vocab_is_eog(vocab, token)) break;
        ++g_last_generated_tokens;

        char piece[512];
        const int32_t piece_size = llama_token_to_piece(vocab, token, piece, sizeof(piece), 0, true);
        if (piece_size > 0) {
            output.append(piece, static_cast<size_t>(piece_size));
            if (callback && on_token) {
                jstring piece_text = to_java_string(env, std::string(piece, static_cast<size_t>(piece_size)));
                env->CallVoidMethod(callback, on_token, piece_text);
                env->DeleteLocalRef(piece_text);
                if (env->ExceptionCheck()) {
                    env->ExceptionClear();
                    g_cancel_requested.store(true, std::memory_order_release);
                    break;
                }
            }
        }

        llama_token next = token;
        llama_batch batch = llama_batch_get_one(&next, 1);
        if (llama_decode(g_context, batch) != 0) break;
    }
    llama_sampler_free(sampler);
    const auto inference_end = Clock::now();
    g_last_generation_ms = std::chrono::duration<double, std::milli>(inference_end - generation_start).count();
    return to_java_string(env, output);
}

extern "C" JNIEXPORT void JNICALL
Java_app_ultran_mobile_NativeLlama_nativeResetGenerationCancellation(JNIEnv *, jclass) {
    // Reset before work is queued so a Stop tap while it waits for the executor is not lost.
    g_cancel_requested.store(false, std::memory_order_release);
}

extern "C" JNIEXPORT void JNICALL
Java_app_ultran_mobile_NativeLlama_nativeCancelGeneration(JNIEnv *, jclass) {
    // Lock-free because nativeGenerate holds g_mutex throughout decoding.
    g_cancel_requested.store(true, std::memory_order_release);
}

extern "C" JNIEXPORT jstring JNICALL
Java_app_ultran_mobile_NativeLlama_nativeGetLastMetrics(JNIEnv *env, jclass) {
    std::lock_guard<std::mutex> lock(g_mutex);
    const double tokens_per_second = g_last_generation_ms > 0.0
        ? static_cast<double>(g_last_generated_tokens) * 1000.0 / g_last_generation_ms
        : 0.0;
    std::ostringstream json;
    json << std::fixed << std::setprecision(2)
         << "{\"promptTokens\":" << g_last_prompt_tokens
         << ",\"generatedTokens\":" << g_last_generated_tokens
         << ",\"promptMs\":" << g_last_prompt_ms
         << ",\"generationMs\":" << g_last_generation_ms
         << ",\"tokensPerSecond\":" << tokens_per_second << "}";
    return env->NewStringUTF(json.str().c_str());
}

extern "C" JNIEXPORT void JNICALL
Java_app_ultran_mobile_NativeLlama_nativeUnloadModel(JNIEnv *, jclass) {
    std::lock_guard<std::mutex> lock(g_mutex);
    release_model();
}
