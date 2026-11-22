# iOS Build Setup Notes

This documents the one-time environment setup needed to build PulseLibre with
Xcode on this machine (Apple Silicon Mac, system Ruby 2.6.10), and the issues
that had to be worked around. Kept here for future reference in case the
environment needs to be rebuilt or another machine hits the same problems.

## Prerequisites

- Node.js 18+ (repo tested with 20.14.0; `@react-native-community/cli` wants
  >=20.19.4 — not blocking, just prints an `EBADENGINE` warning)
- Full Xcode installed via the App Store (`/Applications/Xcode.app`), **not**
  just the Command Line Tools
- CocoaPods, installed per-project via Bundler (see below) — do not rely on a
  global Homebrew `pod`

## One-time machine setup

1. **Point `xcode-select` at full Xcode**, not the Command Line Tools:

   ```bash
   sudo xcode-select -switch /Applications/Xcode.app
   xcodebuild -version   # sanity check
   ```

   Without this, `xcodebuild` fails with "requires Xcode, but active
   developer directory ... is a command line tools instance".

2. **Install a modern Bundler as a user gem.** The system Ruby (2.6.10) ships
   with Bundler 1.17.2, which is too old to correctly resolve platform-specific
   gems on a universal (arm64e/x86_64) Ruby build — it silently installs the
   `x86_64-darwin` variant of native gems (e.g. `ffi`) on this arm64 machine,
   which then fails at load time with `cannot load such file -- ffi_c`. This
   is also why the Homebrew-installed global `pod` binary is broken here.

   ```bash
   gem install bundler -v 2.4.22 --user-install   # newest Bundler that still supports Ruby 2.6
   export PATH="$HOME/.gem/ruby/2.6.0/bin:$PATH"   # put this in ~/.zshrc for iOS work
   ```

3. **Install JS dependencies:**

   ```bash
   npm install
   ```

4. **Install CocoaPods + Ruby deps via Bundler, then the pods:**

   ```bash
   bundle install
   cd ios
   bundle exec pod install
   cd ..
   ```

   Always use `bundle exec pod install`, not a bare `pod install` — the
   project pins CocoaPods via the root `Gemfile`/`Gemfile.lock`.

## What was fixed in the repo config (already applied)

- **`.bundle/config`**: removed `BUNDLE_FORCE_RUBY_PLATFORM: 1`. This was a
  legacy Apple Silicon workaround that forced Bundler to compile native gems
  (`ffi`) from source instead of using precompiled binaries. Under current
  Xcode's clang assembler, that source build fails with
  `invalid CFI advance_loc expression`. Precompiled arm64 binaries work fine
  and are what should be used now.
- **`Gemfile.lock`**: added the `arm64-darwin` platform (`bundle lock
  --add-platform arm64-darwin`) so Bundler resolves precompiled arm64 native
  gems for `ffi` and friends instead of `ruby`/`x86_64-darwin` variants.
  `BUNDLED WITH` was bumped to `2.4.22` to match the Bundler version actually
  used to install.

## Opening the project

Always open the **workspace**, not the `.xcodeproj` directly — CocoaPods
integrates dependencies via the workspace:

```bash
open ios/PulseLibre.xcworkspace
```

or from the repo root:

```bash
npx react-native run-ios
```

## Verifying the toolchain works

A full command-line build (mirrors what Xcode does) can be run with:

```bash
cd ios
xcodebuild -workspace PulseLibre.xcworkspace -scheme PulseLibre \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' build
```

Should end with `** BUILD SUCCEEDED **`.
