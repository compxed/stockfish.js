# Override base settings
EXE = stockfish.js
COMP = em++
CXX = em++
comp = clang
arch = wasm32
bits = 64
SUPPORTED_ARCH=true
WASM_STACK_SIZE_SETTING ?= STACK_SIZE

# The target is WebAssembly regardless of the build host. In particular, do
# not let Stockfish's native Darwin settings pass -arch wasm,
# -mmacosx-version-min, or -mdynamic-no-pic to Emscripten.
KERNEL := Emscripten
TARGET_KERNEL := Emscripten

ifeq ($(ASMJS),yes)
	EM_LDFLAGS  += -s WASM=0
	popcnt = no
	sse = no
	sse2 = no
	ssse3 = no
	sse41 = no
else
	EM_CXXFLAGS += -msimd128
	ifeq ($(relaxedsimd),yes)
		EM_CXXFLAGS += -mrelaxed-simd
	endif
	# CPU settings
	popcnt = no
	sse = yes
	sse2 = yes
	ssse3 = yes
	sse41 = yes
endif


# Compiler flags
EM_CXXFLAGS += -DSTOCKFISH_JS -DUSE_POPCNT -DUSE_SLOPPY_ATOMICS -DPOSIXALIGNEDALLOC

ifeq ($(WASM_DEBUG),yes)
	#EM_CXXFLAGS += -g3 -gsource-map --source-map-base=src/ -s SAFE_HEAP=1 -s ASSERTIONS=1
	#EM_LDFLAGS  += -g3 -gsource-map --source-map-base=src/ -s SAFE_HEAP=1 -s ASSERTIONS=1
	EM_CXXFLAGS += -g3 -gsource-map --source-map-base=/src/ -s ASSERTIONS=1
	EM_LDFLAGS  += -g3 -gsource-map --source-map-base=/src/ -s ASSERTIONS=1
	optimize = no
	# -fsanitize=undefined is currently breaking the large build
	#EM_CXXFLAGS  += -fsanitize=undefined
	#EM_LDFLAGS  += -fsanitize=undefined
	EM_LDFLAGS  += -s NO_FILESYSTEM=0
else
	EM_LDFLAGS  += --closure 1
	EM_LDFLAGS  += -s NO_FILESYSTEM=1
endif


# Enable sanatizers https://emscripten.org/docs/debugging/Sanitizers.html
#EM_CXXFLAGS  += -fsanitize=undefined
#EM_LDFLAGS  += -fsanitize=undefined
#EM_CXXFLAGS  += -fsanitize=address
#EM_LDFLAGS  += -fsanitize=address


# Linker flags
EM_LDFLAGS  += --pre-js emscripten/pre.js

ifeq ($(LITE_NET),yes)
	EM_LDFLAGS  += --extern-pre-js emscripten/credits-lite.js
else
	EM_LDFLAGS  += --extern-pre-js emscripten/credits.js
endif

EM_LDFLAGS  += --extern-pre-js emscripten/extern-pre.js
EM_LDFLAGS  += --extern-post-js emscripten/extern-post.js

#EM_LDFLAGS  += -s INITIAL_MEMORY=536870912
EM_LDFLAGS  += -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=134217728 -s MAXIMUM_MEMORY=2147483648 -Wno-pthreads-mem-growth
# Ignore irrelevant warning
EM_CXXFLAGS += -Wno-pthreads-mem-growth
EM_LDFLAGS  += -s ENVIRONMENT=web,worker,node
EM_LDFLAGS  += -s EXIT_RUNTIME=0
EM_LDFLAGS  += -s MODULARIZE=1
EM_LDFLAGS  += -s EXPORT_NAME="Stockfish"
#EM_LDFLAGS  += -s NO_FILESYSTEM=1
#EM_LDFLAGS  += -s EXPORTED_FUNCTIONS="['_main','_command']"

EM_LDFLAGS  += -s EXPORTED_RUNTIME_METHODS=ccall
EM_LDFLAGS  += -s LLD_REPORT_UNDEFINED

# Emscripten 6 defaults to a 64 KiB stack, which is too small for a recursive
# Stockfish search. This also becomes the default stack size of pthreads.
EM_LDFLAGS  += -s $(WASM_STACK_SIZE_SETTING)=8388608

ifeq ($(WASM_SINGLE_THREADED),yes)
	EM_CXXFLAGS += -D__EMSCRIPTEN_SINGLE_THREADED__
	#EM_LDFLAGS  += --extern-post-js emscripten/extern-post-single.js
	#EM_LDFLAGS += -s EXPORTED_FUNCTIONS="['_stop', '_ponderhit', '_main']"
	# Add a second pre-js file.
	#EM_LDFLAGS  += --pre-js emscripten/pre-single-threaded.js
	EM_LDFLAGS  += -s ASYNCIFY=1
	EM_LDFLAGS  += -s ASYNCIFY_STACK_SIZE=10485760
	EM_LDFLAGS  += -s EXPORTED_FUNCTIONS="['_main','_command','_isReady','_isSearching']"
	EM_LDFLAGS  += --extern-pre-js emscripten/extern-pre-async.js
else
	EM_CXXFLAGS += -pthread
	EM_LDFLAGS  += -pthread
	EM_LDFLAGS  += -s EXPORTED_FUNCTIONS="['_main','_command','_isReady','_isSearching']"
	#EM_LDFLAGS  += --extern-post-js emscripten/extern-post.js
	EM_LDFLAGS  += -s PROXY_TO_PTHREAD
endif





#EM_CXXFLAGS  += -s PTHREAD_POOL_SIZE=5
#EM_LDFLAGS  += -s PTHREAD_POOL_SIZE=5
#EM_CXXFLAGS  += -s PTHREAD_POOL_SIZE_STRICT=2
#EM_LDFLAGS  += -s PTHREAD_POOL_SIZE_STRICT=2

#EM_LDFLAGS  += -s ASYNCIFY=1
#EM_LDFLAGS  += -s 'ASYNCIFY_IMPORTS=["emscripten_utils_getline_impl"]'


EXTRACXXFLAGS += $(EM_CXXFLAGS)
EXTRALDFLAGS += $(EM_LDFLAGS)
