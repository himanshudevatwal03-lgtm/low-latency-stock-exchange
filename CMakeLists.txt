cmake_minimum_required(VERSION 3.20)
project(matching_engine CXX)

if(CMAKE_INSTALL_PREFIX_INITIALIZED_TO_DEFAULT)
    set(CMAKE_INSTALL_PREFIX "${CMAKE_SOURCE_DIR}/tests" CACHE PATH
        "Install the Python extension beside the test suite by default" FORCE)
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ---------------------------------------------------------------------------
# Compiler flags
# ---------------------------------------------------------------------------
if(MSVC)
    add_compile_options(/W4 /O2)
else()
    add_compile_options(-Wall -Wextra -O3 -march=native)
endif()

# ---------------------------------------------------------------------------
# Engine library
# ---------------------------------------------------------------------------
add_library(engine STATIC src/engine.cpp)
target_include_directories(engine PUBLIC include)
set_target_properties(engine PROPERTIES POSITION_INDEPENDENT_CODE ON)

# ---------------------------------------------------------------------------
# Benchmark executable
# ---------------------------------------------------------------------------
add_executable(bench bench/bench.cpp)
target_link_libraries(bench PRIVATE engine)
if(NOT MSVC)
    target_link_libraries(bench PRIVATE m)
endif()

# ---------------------------------------------------------------------------
# Python bindings via pybind11 (fetched automatically)
# ---------------------------------------------------------------------------
include(FetchContent)
FetchContent_Declare(
    pybind11
    GIT_REPOSITORY https://github.com/pybind/pybind11.git
    GIT_TAG        v2.13.6
)
FetchContent_MakeAvailable(pybind11)

pybind11_add_module(orderbook bindings/bindings.cpp)
target_link_libraries(orderbook PRIVATE engine)

# ---------------------------------------------------------------------------
# Install the extension into a caller-selected prefix. For local tests, use
# `cmake --install build --prefix "$PWD/app/native"`; Docker installs it into
# `/opt/engine`.
# ---------------------------------------------------------------------------
install(TARGETS orderbook LIBRARY DESTINATION . RUNTIME DESTINATION .)
