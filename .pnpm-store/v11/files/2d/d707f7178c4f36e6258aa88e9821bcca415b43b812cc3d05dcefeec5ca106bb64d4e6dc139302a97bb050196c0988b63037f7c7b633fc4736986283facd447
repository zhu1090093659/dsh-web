{
  "conditions": [
    [
      "OS!=\"win\" and target_arch not in \"ia32 x32 x64\"",
      {
        "defines": [
          "HAVE_STRONG_GETAUXVAL=1",
          "HAVE_DLFCN_H=1",
          "HAVE_GETAUXVAL=1"
        ],
        "libraries": [],
        "sources": [
          "deps/cpu_features/include/internal/hwcaps.h",
          "deps/cpu_features/src/hwcaps.c"
        ]
      }
    ]
  ]
}
