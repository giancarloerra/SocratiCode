# Changelog

All notable changes to SocratiCode are documented here.
This project uses [Conventional Commits](https://www.conventionalcommits.org/) and [Semantic Versioning](https://semver.org/).


## [1.16.2](https://github.com/giancarloerra/socraticode/compare/v1.16.1...v1.16.2) (2026-11-05)

* disable checkout credentials in new validation jobs ([fcc4d4d](https://github.com/giancarloerra/socraticode/commit/fcc4d4d15025ecd3bbbc1a7fcd2aa08f0c5f7576))
* update packages and fix Ollama proxy authentication ([3772c41](https://github.com/giancarloerra/socraticode/commit/3772c41485ca4ab396f1102e5f5efba9b92226e5))

### Bug Fixes

* **graph:** bind C# aliases where declared, and type-named values by type identity ([d9b8700](https://github.com/giancarloerra/socraticode/commit/d9b870028b950f562090389eecca55f677791576))
* **graph:** consult each C# import at its own namespace level ([e38dca3](https://github.com/giancarloerra/socraticode/commit/e38dca37b0bb68626b2f7f1266434f7c0b9e5992))
* **graph:** keep the written C# path and look names up as C# does ([4041e70](https://github.com/giancarloerra/socraticode/commit/4041e70befa625b47a5b162dea97f2be927d1a9a)), references [#209](https://github.com/giancarloerra/socraticode/issues/209) [#208](https://github.com/giancarloerra/socraticode/issues/208)
* **graph:** look each C# base up once ([74189a3](https://github.com/giancarloerra/socraticode/commit/74189a3c7f1e6eeb9d718e647b78b3213c45edbc))
* **graph:** name C# declarations by their name field and capture type, creation and qualified-call edges ([d0aac8d](https://github.com/giancarloerra/socraticode/commit/d0aac8d4ca9a44433a6579bacf66fbf799c99aa6))
* **graph:** narrow C# framework paths, skip tuple labels, keep global usings to their file ([87e2d66](https://github.com/giancarloerra/socraticode/commit/87e2d66774a02ce71737098e9d7e0f43ae570fb9))
* **graph:** read a C# receiver that names a value as an instance call ([5c907d3](https://github.com/giancarloerra/socraticode/commit/5c907d315dd54bda47dcd6baa6374ddbf6bea371))
* **graph:** record a C# record struct as a struct ([4dbfc01](https://github.com/giancarloerra/socraticode/commit/4dbfc01f08e7744b3496da099ca174f0465f3bf9))
* **graph:** resolve C# names only through the scopes and imports C# uses ([692963c](https://github.com/giancarloerra/socraticode/commit/692963c274d3133a1483e7251a1ee58c551adcad))
* normalize TypeScript configuration paths on Windows ([ceb9c7d](https://github.com/giancarloerra/socraticode/commit/ceb9c7da48744e00d4cbf69044605da2fb9338db))
* preserve installed package bindings in workspace graphs ([8be6abb](https://github.com/giancarloerra/socraticode/commit/8be6abb4beb7841412b604780bbb40a20ca1e367))
* preserve installed workspace links and missing-base aliases ([6653435](https://github.com/giancarloerra/socraticode/commit/6653435efaea5abd4ccfe627c48360297f22b91b))
* preserve managed diagnostics and verify native platforms ([650b5df](https://github.com/giancarloerra/socraticode/commit/650b5dfaabc5ed4fecb26e20795de62ece117c14))
* preserve Ollama authentication and simplify MCP test teardown ([a5bc960](https://github.com/giancarloerra/socraticode/commit/a5bc960fb7cf052fa61beb8b5aa21a81418d234c))
* preserve Ollama policy errors and late-exit cleanup ([106bb39](https://github.com/giancarloerra/socraticode/commit/106bb3980b1b556ea504729c4d89d8bce2f38100))
* preserve Ollama transport policy and diagnostics ([43d6afd](https://github.com/giancarloerra/socraticode/commit/43d6afd90383e610a0d0e60dcf7c995f4ea30553))
* release model download timers and verify managed startup ([32cdff4](https://github.com/giancarloerra/socraticode/commit/32cdff4a878201e46defbf131c1c86f7f43eb914))
* resolve monorepo imports using importer TypeScript configuration ([f22a134](https://github.com/giancarloerra/socraticode/commit/f22a134b48304cafbfa3b3b6f908a16ad7846be6))
* **search:** name the filter when a filtered codebase_search finds nothing ([5f42476](https://github.com/giancarloerra/socraticode/commit/5f42476526f89c8c0851446602955eb6cb66d557)), closes [#207](https://github.com/giancarloerra/socraticode/issues/207)
* use consistent native path canonicalization for graph inputs ([22cfea1](https://github.com/giancarloerra/socraticode/commit/22cfea1b797dc8a6b2a56a730a03ee1aac527bc4))

### Documentation

* clarify Node requirements by workflow ([1e8504b](https://github.com/giancarloerra/socraticode/commit/1e8504bf0ace5a41103e0c9cb85b8d62b60dace4))

### Tests

* await logging server closure before cleanup ([8dd7b8c](https://github.com/giancarloerra/socraticode/commit/8dd7b8c957d05e04094fb75eaf9fb241a1d69926))
* bound Windows descendant cleanup ([a64101f](https://github.com/giancarloerra/socraticode/commit/a64101f30873ea8e2a6921ec3263108ed362beeb))
* expose Windows process lookup errors ([0105edb](https://github.com/giancarloerra/socraticode/commit/0105edbb9e74b171b51979ca6996fef7271254da))
* **graph:** pin a C# call through a lowercase namespace ([59943a5](https://github.com/giancarloerra/socraticode/commit/59943a5ce503271e6bfa748e077584b642983228))
* keep Windows descendant fixture alive ([3d9c5b2](https://github.com/giancarloerra/socraticode/commit/3d9c5b2d5ee728a533e37fa9fd9b4cfa360746e4))
* make compatibility fixtures portable ([b8b9d62](https://github.com/giancarloerra/socraticode/commit/b8b9d62106f31b01cee2aa24e2bd56eb208b8f0b))
* measure Windows process lookup startup ([725000e](https://github.com/giancarloerra/socraticode/commit/725000e8789198f8d0682aaad2e328d1a34882e5))
* remove lookup timing diagnostics ([427941c](https://github.com/giancarloerra/socraticode/commit/427941c69fa592865bd38c574ecf8f9ddf476606))
* scope deadline mocks and configure managed endpoint ([42968e9](https://github.com/giancarloerra/socraticode/commit/42968e96c30a39d7e3bf0562f9037d4d70f78f68))

## [1.16.1](https://github.com/giancarloerra/socraticode/compare/v1.16.0...v1.16.1) (2026-10-15)

### Features

* **graph:** add limit to codebase_symbol, codebase_impact and codebase_flow ([0f48a19](https://github.com/giancarloerra/socraticode/commit/0f48a191e42ccf5451507f8c84fb562925058aef)), closes [#203](https://github.com/giancarloerra/socraticode/issues/203)
* opt-in cleanup of retired local indexes ([100bc72](https://github.com/giancarloerra/socraticode/commit/100bc728ff16697cff620a732a233a7fd9be4d4a))

### Bug Fixes

* **graph:** name attributed PHP declarations by their name field ([3b74ab6](https://github.com/giancarloerra/socraticode/commit/3b74ab65c6913a1846213730f8ae55541c65b65a))
* **graph:** preserve classic JVM precedence with KMP source sets ([7ec0297](https://github.com/giancarloerra/socraticode/commit/7ec029718e18937ccbe7aed68f36f8ec831625bc))
* **graph:** resolve JVM imports in Kotlin Multiplatform / Gradle source sets ([a9d5eb1](https://github.com/giancarloerra/socraticode/commit/a9d5eb1c24971061fd6dba2c1d157e1980bd6232))
* **graph:** select KMP imports by caller source set ([413e47d](https://github.com/giancarloerra/socraticode/commit/413e47d15a94874fd15b48f2e674bc53b179d42b))
* preserve proven local index ownership ([6d6725a](https://github.com/giancarloerra/socraticode/commit/6d6725af185b1224776560267a8aa021abeec0f9))
* **qdrant:** complete dispatcher probe and cover initialization ([85b96a1](https://github.com/giancarloerra/socraticode/commit/85b96a1f7c6145e628554dac80b5a025c39356d6))
* **qdrant:** probe the undici pair instead of matching a Node version ([70a8b2f](https://github.com/giancarloerra/socraticode/commit/70a8b2f9ab00ce0a6b7fb907500a99da6e74fe57))
* **symbol-graph:** retry Qdrant requests once on a closed connection ([0418bd9](https://github.com/giancarloerra/socraticode/commit/0418bd971152025d7cd9d5fb71d857b4fade693b))

### Tests

* **graph:** cover first incremental update after upgrade ([3ca6659](https://github.com/giancarloerra/socraticode/commit/3ca6659e387adcb47408246efa159b09e8148fab))
* isolate automatic cleanup interval timers ([be9a14e](https://github.com/giancarloerra/socraticode/commit/be9a14ec0c9c537c43d47258734567d01f043997))

## [1.16.0](https://github.com/giancarloerra/socraticode/compare/v1.15.0...v1.16.0) (2026-09-28)

### Features

* **index:** add opt-in Git-triggered refresh ([647b690](https://github.com/giancarloerra/socraticode/commit/647b690ec0291094bfaa302a74fe609039980008))

### Bug Fixes

* **index:** preserve Git refresh startup state ([aeaba30](https://github.com/giancarloerra/socraticode/commit/aeaba30089629782bd51f4b87b356f78925ed9da))
* **index:** wait for Git refresh deletions to complete ([fe2dacf](https://github.com/giancarloerra/socraticode/commit/fe2dacf51507ebec24820207d6219e3ca12fa4a5))

### Documentation

* add quick setup and scenario guides ([88018f7](https://github.com/giancarloerra/socraticode/commit/88018f7f6f752174082aaefe563faef765cf03c8))
* clarify editor setup steps ([abf49d1](https://github.com/giancarloerra/socraticode/commit/abf49d185e7c031f6f769967eb4449f7c0ff7ca3))
* clarify VS Code indexing prompt ([67a0e73](https://github.com/giancarloerra/socraticode/commit/67a0e73a8494f8a90d7247f49761712309de3dcc))
* correct quick guide links and linked index requirements ([393ba4d](https://github.com/giancarloerra/socraticode/commit/393ba4d489790fe3c83cb869f98e2a6ecab14e53))
* note BYOK option for VS Code chat ([65957f9](https://github.com/giancarloerra/socraticode/commit/65957f9936efdf69c5c55cf0a74acdf8463b70e4))
* qualify VS Code BYOK availability ([c4e8573](https://github.com/giancarloerra/socraticode/commit/c4e857383c15255fd05f335c93870bea0cc23646))
* remove Roo Code setup guidance ([a839224](https://github.com/giancarloerra/socraticode/commit/a839224cb0efbdc1489436a6febcc5f52fc623ff))
* use Gemini direct MCP and note Zed trust ([f290d90](https://github.com/giancarloerra/socraticode/commit/f290d90b63fb55d8604f7b209ac8498609a498ce))

### Tests

* **index:** cover Git restart recovery and document helpers ([ec445ad](https://github.com/giancarloerra/socraticode/commit/ec445ad599e746c684c8c7c3de9be632cb095548))

## [1.15.0](https://github.com/giancarloerra/socraticode/compare/v1.14.0...v1.15.0) (2026-09-24)

### Features

* allow the Claude Code plugin engine specification to be pinned ([0c33776](https://github.com/giancarloerra/socraticode/commit/0c337761eef8f19502b12990c25795cbbba77d06)), closes [#149](https://github.com/giancarloerra/socraticode/issues/149)
* **graph:** read PHP typed property declarations as type references ([9afedae](https://github.com/giancarloerra/socraticode/commit/9afedae8f8c10f51dec0edab5a6c2139f67b8879))

### Bug Fixes

* **graph:** apply a PHP `use` alias only below the `use` that declares it ([7433a53](https://github.com/giancarloerra/socraticode/commit/7433a5349ace780c276349fbf07ed6e7d35dee50))
* **graph:** capture PHP extends, implements, trait use, new and type-hint edges ([68b2eca](https://github.com/giancarloerra/socraticode/commit/68b2ecaa95e9df4f847b413b3d8711f2535f8542))
* **graph:** correct five PHP alias and type-reference gaps ([5d1f225](https://github.com/giancarloerra/socraticode/commit/5d1f225ff36c8e99fd6ed110be11d03d652054e2))
* **graph:** drop a type reference the parse split off an identifier ([b8cf848](https://github.com/giancarloerra/socraticode/commit/b8cf848d5da04623cab6ad2abe3071ded31dfe5e))
* **graph:** find a qualified PHP class by its exact name outside the caller's dependencies ([258fe80](https://github.com/giancarloerra/socraticode/commit/258fe80213e4f9d6ae55df5e6e1f52d62f51a891))
* **graph:** fold PHP alias case over ASCII only, as the language does ([93d614b](https://github.com/giancarloerra/socraticode/commit/93d614bf4e943ac8bfe263f2face7bf159f01889))
* **graph:** follow verified PHP inheritance for static calls ([7749032](https://github.com/giancarloerra/socraticode/commit/77490323b60ee31399fb535b754e939882fe4229))
* **graph:** leave a PHP static call on a variable method unqualified ([0b97f46](https://github.com/giancarloerra/socraticode/commit/0b97f46a387fbe34230f265addb3338aac50d359))
* **graph:** read a PHP variadic parameter's type as a type reference ([4aadb27](https://github.com/giancarloerra/socraticode/commit/4aadb2716dfc56f43427f89751cb1df636da4d29))
* **graph:** read PHP names by the language's identifier rule, non-ASCII included ([78154d2](https://github.com/giancarloerra/socraticode/commit/78154d20e84663473118e0d9d89d699d7901d7e8))
* **graph:** resolve PHP static calls and class references by the class they name ([2522c49](https://github.com/giancarloerra/socraticode/commit/2522c49f0cf7cc71d92f7894fb314bf411f71943)), closes [#183](https://github.com/giancarloerra/socraticode/issues/183)
* **graph:** scope PHP `use` aliases to their namespace, not the file ([6dcbd68](https://github.com/giancarloerra/socraticode/commit/6dcbd688dc746730930de41c36e9908ef75b91ae))
* keep Qdrant's error reason and deliver MCP log notifications ([9f65b50](https://github.com/giancarloerra/socraticode/commit/9f65b5063b4928ab6c713665b3660f383511f286)), closes [#178](https://github.com/giancarloerra/socraticode/issues/178)
* **qdrant:** wait for this process's collection create before reading it ([5b8eb16](https://github.com/giancarloerra/socraticode/commit/5b8eb16e739eafe871c695e23dcc23a6de5448d5)), closes [#176](https://github.com/giancarloerra/socraticode/issues/176)

### Performance

* **graph:** read both anonymous function forms in one traversal ([ad7a045](https://github.com/giancarloerra/socraticode/commit/ad7a045ba8725080d143e8fef1a8cd529b403000))
* **graph:** read PHP namespace declarations from the top level only ([2f41a20](https://github.com/giancarloerra/socraticode/commit/2f41a20238f2c4c445d21e512b7a851812466322))
* **graph:** stop the PHP extractor re-walking the tree for what it holds ([254ff18](https://github.com/giancarloerra/socraticode/commit/254ff1860b58557643dcd608c8a1aee8d1c36ff8))

### Refactors

* **graph:** drop the PHP namespace scopes' shortest-first sort ([3eb0707](https://github.com/giancarloerra/socraticode/commit/3eb07079f307eea03291e087a2b84d656fd1f5c0))
* **graph:** name the anonymous return-type bucket for what it is ([9dd1744](https://github.com/giancarloerra/socraticode/commit/9dd1744aa347cf2128e6784c426c8c107888f6b6))

### Documentation

* **graph:** consolidate the anonymous return-type comment ([a008a5d](https://github.com/giancarloerra/socraticode/commit/a008a5d94be36a81b26a9b172716ddb7fa3dad6b))
* **graph:** fold the built-in list's exclusion note into its doc comment ([22697ba](https://github.com/giancarloerra/socraticode/commit/22697baa5d1fe4a673451b518f334d2bec201f4d))
* **graph:** list every reference the structural pass now reads ([74fac31](https://github.com/giancarloerra/socraticode/commit/74fac3111e1810191a065328bb8daf15ef787239))
* **graph:** name the node the alias resolver actually walks ([aa5d102](https://github.com/giancarloerra/socraticode/commit/aa5d10274d803fad5d839cfecb5972fb9010eb91))
* **graph:** record the PHP type-name guard's ASCII restriction ([13cfe2c](https://github.com/giancarloerra/socraticode/commit/13cfe2cac9049330a52eeb9b2df2840b0d57ed7f))
* **graph:** spell the KELVIN SIGN as an escape, not as a character ([d9ff91c](https://github.com/giancarloerra/socraticode/commit/d9ff91c038435cbd0cbec1766447022f50ae0680))

### Tests

* **graph:** cover PHP structural edges at the extractor and at a real build ([3b42f3f](https://github.com/giancarloerra/socraticode/commit/3b42f3f37f6f17e5e591d50c0721c6aba5dc131a))
* **graph:** give the `parent` type-hint fixture a parent class ([9135992](https://github.com/giancarloerra/socraticode/commit/9135992fe978f23f571e0e87c5e57aa798d761db))
* **graph:** give the shared-line braced-namespace test valid PHP ([1a5be0f](https://github.com/giancarloerra/socraticode/commit/1a5be0f8ad536f2b60b680102c75f0e5f638df95))
* **graph:** resolve non-ASCII PHP names through a real graph build ([e197a7e](https://github.com/giancarloerra/socraticode/commit/e197a7e6a2614be2133850d4a3f41ba5b6ac6be1))
* **graph:** resolve PHP qualified edges through a real graph build ([bf09caf](https://github.com/giancarloerra/socraticode/commit/bf09caf1a8793e43c0e64c3eb27b169077d21f8e))

## [1.14.0](https://github.com/giancarloerra/socraticode/compare/v1.13.3...v1.14.0) (2026-09-16)

### Features

* **graph:** support configured Python import roots ([fe2def5](https://github.com/giancarloerra/socraticode/commit/fe2def54fd1d288842055904fa652e3ade21ffcb))
* **index:** reclaim stored identities explicitly ([a74cf6c](https://github.com/giancarloerra/socraticode/commit/a74cf6cd4975b2b87c4db549008f121d84e8053e))

### Bug Fixes

* **config:** keep the resolver documented, and only advise what is true ([ef9edbc](https://github.com/giancarloerra/socraticode/commit/ef9edbcbe158fc596bfe50a76ee6de902b40f0a5))
* **config:** treat an unusable branch name as no branch, and unsign the fixture ([6401b8c](https://github.com/giancarloerra/socraticode/commit/6401b8c597936a4b7567433a015cf2f529c718da))
* **config:** warn when branch-aware mode is ignored by an explicit project id ([68f4ded](https://github.com/giancarloerra/socraticode/commit/68f4dedf96981c3750f0daeb32b1a7fa9e4d4854))
* **graph:** name the engine exclusion in the unresolved share, pin the test identity ([65638d3](https://github.com/giancarloerra/socraticode/commit/65638d395725d9240666f8beec367ec3073905ba))
* **graph:** say what the unresolved call share counts ([8330069](https://github.com/giancarloerra/socraticode/commit/83300696936ae32c3eb60b9e71a708b8941defc2)), closes [#172](https://github.com/giancarloerra/socraticode/issues/172)
* **graph:** state the denominator as captured symbol edges ([974d572](https://github.com/giancarloerra/socraticode/commit/974d5721d56ff1762981d138a9f720b9f67260f3))
* **index, watch:** stand down when the re-entered lock is the barrier's ([4866280](https://github.com/giancarloerra/socraticode/commit/4866280da243386487be8520484f86369466c272))
* **index, watch:** take the writer lock non-reentrantly, never by inference ([fdf60d7](https://github.com/giancarloerra/socraticode/commit/fdf60d75f0377278e145570e08ab24beb00b5590))
* **indexing:** address the review on the character-cap split ([29e5323](https://github.com/giancarloerra/socraticode/commit/29e5323ee56ed7a107f6b4b4770af93ba05fc036))
* **indexing:** preserve minified chunk boundaries ([cacc518](https://github.com/giancarloerra/socraticode/commit/cacc518c0e66c448b2edeb5b64fb3a9d3d79e6b4))
* **indexing:** split chunks at the character cap instead of truncating ([d57ae21](https://github.com/giancarloerra/socraticode/commit/d57ae216a661b87c7509cc395e484468b9856a50))
* **prune:** correct the reclamation pass after review ([0eb2b6f](https://github.com/giancarloerra/socraticode/commit/0eb2b6f3b84dba1127908faac4e9919ed8e6ba21))
* **prune:** cover the manual-inspection hold in the confirmation token ([9677af3](https://github.com/giancarloerra/socraticode/commit/9677af3eae721b26eb2dad58711c957fe0d6dbde))
* **prune:** hold back candidates of unsettled names and stop on a lost barrier ([d8bfc17](https://github.com/giancarloerra/socraticode/commit/d8bfc17066327a9e7d98d57adc750448c119bb16))
* **prune:** settle ambiguous names, close the barrier race, cache by identity ([71e0a86](https://github.com/giancarloerra/socraticode/commit/71e0a86bf35260d732547e31b3d68614f7aded2a))

### Performance

* **graph:** rebuild only when a graph input changed ([cb480de](https://github.com/giancarloerra/socraticode/commit/cb480de38c9e25fbba416b1516ccfef81fccd265)), closes [#120](https://github.com/giancarloerra/socraticode/issues/120)

### Documentation

* explain Codex Desktop npx PATH failure ([88feca7](https://github.com/giancarloerra/socraticode/commit/88feca7a069320a38bcb56942f9e72ef844e7d38))
* **extension:** carry the explicit-id exception into the extension README ([b629db1](https://github.com/giancarloerra/socraticode/commit/b629db16e439d612f0cd3d5c040ceb978c5ef709))
* **indexing:** describe legacy chunk coverage ([202bb86](https://github.com/giancarloerra/socraticode/commit/202bb86fc0e76e5d10afeb6b7920ff6e5ac5ff09))

### Tests

* **graph:** remove the fixture graph the unresolved-share case persists ([0e68469](https://github.com/giancarloerra/socraticode/commit/0e68469cdd10b15c44503d5a89446c520c32434d))
* **indexing:** exercise chunk line mapping ([4a0d508](https://github.com/giancarloerra/socraticode/commit/4a0d5083b57976fcbc0a6594be3fa26bbc287adc))
* **indexing:** retrieve intact minified identifiers ([afe6647](https://github.com/giancarloerra/socraticode/commit/afe664707d4a2460f41cfc53b7544470447e43ee))
* **reclamation:** pin identities against an ambient SOCRATICODE_PROJECT_ID ([fbd8278](https://github.com/giancarloerra/socraticode/commit/fbd827841b4ec07e2cfd195de9f21468d57b5aec))

## [1.13.3](https://github.com/giancarloerra/socraticode/compare/v1.13.2...v1.13.3) (2026-09-10)

### Bug Fixes

* **config:** do not treat an external git directory as the main worktree ([c68c5d0](https://github.com/giancarloerra/socraticode/commit/c68c5d0082da5f2c735799ad3b0fbea1413a90cf))
* **graph:** a project-root self match must end resolution, not fall through ([5504a5c](https://github.com/giancarloerra/socraticode/commit/5504a5cb24716ad758436dc6de9ea82321e242de))
* **graph:** drop the __init__.py gate, keep only the unambiguous self guards ([a07196d](https://github.com/giancarloerra/socraticode/commit/a07196db7ea4190b5832f9ab5a1784c335fc0e76)), closes [#46](https://github.com/giancarloerra/socraticode/issues/46) [#107](https://github.com/giancarloerra/socraticode/issues/107) [#46](https://github.com/giancarloerra/socraticode/issues/46) [#112](https://github.com/giancarloerra/socraticode/issues/112)
* **graph:** end resolution on a self match at every real path entry, not just the root ([b40b5e8](https://github.com/giancarloerra/socraticode/commit/b40b5e860fe6c25654f7e84b167a2f87fd8a126c))
* **graph:** extend the [#157](https://github.com/giancarloerra/socraticode/issues/157) self-edge guard to relative imports ([fcac832](https://github.com/giancarloerra/socraticode/commit/fcac832a4ca73be4dfb5d439737e602570376c48))
* **graph:** gate on any package ancestor, not just the importing directory ([d650753](https://github.com/giancarloerra/socraticode/commit/d650753384b2cbdbe1dffdd3ff242a350f4b36e6)), closes [#46](https://github.com/giancarloerra/socraticode/issues/46)
* **graph:** stop the Python sibling fallback fabricating edges inside packages ([740fe6f](https://github.com/giancarloerra/socraticode/commit/740fe6f0cac8cf1be673cefdccc6faa3f7fc24d3)), closes [#46](https://github.com/giancarloerra/socraticode/issues/46) [#46](https://github.com/giancarloerra/socraticode/issues/46) [#157](https://github.com/giancarloerra/socraticode/issues/157)
* **indexer:** gate after the artifact config read, and announce after checking ([fd6c9cc](https://github.com/giancarloerra/socraticode/commit/fd6c9cc96645e35a0787c67cc1f597a0d2b0b744))
* **indexer:** gate the terminal status write, and the graph rebuild ([b0905c1](https://github.com/giancarloerra/socraticode/commit/b0905c1c916e589bd675370b37f76ef7187d8328))
* **indexer:** read indexing status strictly, and pin recovery in CI ([c559db7](https://github.com/giancarloerra/socraticode/commit/c559db7872d7b418a15e53ff084d16d40479f1be))
* **indexer:** reconcile stale hashes against the points actually stored ([28db487](https://github.com/giancarloerra/socraticode/commit/28db48716d59f06f102aea309b33372e481a6d65))
* **indexer:** repair a completed status written as the lock was lost ([e8a4009](https://github.com/giancarloerra/socraticode/commit/e8a40097164f25fa3983485a570d7a1884bd6582))
* **indexer:** stop writing once ownership is lost, and never past a phase ([e5f1246](https://github.com/giancarloerra/socraticode/commit/e5f1246732d09a8e8d94a04d11c45db04979e5ff))
* **lock:** handle a rejecting compromise handler, and restore a displaced doc ([5ed44eb](https://github.com/giancarloerra/socraticode/commit/5ed44ebc6baa1cdc7391c737ba0eb42f5f87b591))
* **lock:** stand down when the index lock is lost mid-run ([f742845](https://github.com/giancarloerra/socraticode/commit/f742845b8c83d07c14d501abcf8842fb928cd0af))
* **qdrant:** retry, bound and share the paged payload scroll ([f46f85d](https://github.com/giancarloerra/socraticode/commit/f46f85dd2be8d23d59b741bc0b1a8a5277a9c9e3))
* **qdrant:** scroll project metadata by page, and read only the field used ([79b4604](https://github.com/giancarloerra/socraticode/commit/79b4604418895fca9deab66f119a48bce77ab450))
* **startup:** resolve a linked worktree to its main checkout before resuming ([915b20b](https://github.com/giancarloerra/socraticode/commit/915b20bbe4cc631e755e010ee46f00f7439f1fd2))

### Documentation

* **graph:** name a reachable example in the sibling fall-through comment ([19b94ac](https://github.com/giancarloerra/socraticode/commit/19b94ac718737d347836d8f01fc963ef3cfe8378))

### Tests

* make the linked checkout participate in the worktree regression ([fe9e4c4](https://github.com/giancarloerra/socraticode/commit/fe9e4c4d30e907d5bcb377e92e1337c636e69c19))
* make the status-read regression exercise the indexing entry point ([f197357](https://github.com/giancarloerra/socraticode/commit/f197357bc934e7b2d22a8cb8cf5bc3183a32edab))

## [1.13.2](https://github.com/giancarloerra/socraticode/compare/v1.13.1...v1.13.2) (2026-09-09)

### Bug Fixes

* **indexer:** do not mark a file indexed when its upsert was partially skipped ([ff3c06b](https://github.com/giancarloerra/socraticode/commit/ff3c06bbf09784a9bb1bcfdfafd650f9cc2904f7))
* **indexer:** exclude stranded files with stale hashes from filesIndexed ([388773b](https://github.com/giancarloerra/socraticode/commit/388773b0368bc97815bcd8621a947eab6c61d85a))
* **indexer:** report files actually indexed, not files walked ([07dd187](https://github.com/giancarloerra/socraticode/commit/07dd18781999d022d5a7293914c02e1e727447bd))
* **indexer:** report files the index represents, not files walked ([a511f27](https://github.com/giancarloerra/socraticode/commit/a511f27437a45911a984d407f2db4bfd821cc006))
* **qdrant:** fail the operation when any point is skipped after fallback ([c47a843](https://github.com/giancarloerra/socraticode/commit/c47a843d2065defcb78371cac642c06ab50f8db5))

### Tests

* **helpers:** build the Qdrant test client from the service's getClient() ([27eed85](https://github.com/giancarloerra/socraticode/commit/27eed85aca674e220cd12ae40902c6b184a8db71))
* reach Qdrant through the service client, not the raw test helper ([a46bc11](https://github.com/giancarloerra/socraticode/commit/a46bc11c903a5d99d1e09ae88bcb0dd5fbbe6fe8))

## [1.13.1](https://github.com/giancarloerra/socraticode/compare/v1.13.0...v1.13.1) (2026-09-07)

### Bug Fixes

* **qdrant:** accept valid prerelease identifiers ([b043e58](https://github.com/giancarloerra/socraticode/commit/b043e589040e07e3664db979a4f0efa36fd19bdc))
* **qdrant:** support Node 26 without dropping Node 18 ([d7008bd](https://github.com/giancarloerra/socraticode/commit/d7008bd555c054ba48f8c8e657c788d76568d3cc))

### Performance

* **qdrant:** bypass bridge work for ordinary fetches ([b973c01](https://github.com/giancarloerra/socraticode/commit/b973c01de0dc27b5f913903020c37216f6e6e733))

### Tests

* **qdrant:** harden Node 26 compatibility checks ([e76aaae](https://github.com/giancarloerra/socraticode/commit/e76aaae35929e40461b6fad3fba9f54a76307dd3))

## [1.13.0](https://github.com/giancarloerra/socraticode/compare/v1.12.0...v1.13.0) (2026-09-07)

### Features

* add manual indexing mode ([1e6fb5d](https://github.com/giancarloerra/socraticode/commit/1e6fb5de564087d4bc10d344b66caa789d9439df))
* **embeddings:** make task prefixes configurable per model ([cd4c8b0](https://github.com/giancarloerra/socraticode/commit/cd4c8b0773c731c9d883a13e645ee6f287ca7863))
* **embeddings:** make the embedded file path optional ([87b677d](https://github.com/giancarloerra/socraticode/commit/87b677dbb43e4d80527a7815487550c420000642))
* **gdscript:** symbol graph — AST symbols, call graph, incremental updates ([a9f1fbe](https://github.com/giancarloerra/socraticode/commit/a9f1fbede9d88721edafd0a4b504a8dedb830577)), closes [#130](https://github.com/giancarloerra/socraticode/issues/130)
* **graph:** decide Rust cases by one rule, and read include! because it passes ([76720b6](https://github.com/giancarloerra/socraticode/commit/76720b636186ec385f7f39bf30cdbae96d7dbcc1))
* **index:** add Elixir AST support ([#113](https://github.com/giancarloerra/socraticode/issues/113)) ([bd19922](https://github.com/giancarloerra/socraticode/commit/bd1992212f29648e86c2b5d8a46ddafe7f82d4e0))
* **indexing:** make the per-chunk character cap configurable ([a7c8ed6](https://github.com/giancarloerra/socraticode/commit/a7c8ed6840834e5aa2cfb5b1213e7b68c093ad8a))
* **lmstudio:** accept OpenAI-compatible servers without /v1/models ([e1d8034](https://github.com/giancarloerra/socraticode/commit/e1d803494fec00fb84e3ea53b646cb6b9f6bf17d))
* native GDScript (Godot) support — loader, TSCN/TRES, import extraction ([b6a6fcb](https://github.com/giancarloerra/socraticode/commit/b6a6fcb1121cb1e7629f881528e946c70d73ec17))

### Bug Fixes

* apply CodeRabbit auto-fixes ([339ed45](https://github.com/giancarloerra/socraticode/commit/339ed451c052eb53c5a0008faec9686e36026972))
* complete manual-mode status reporting ([0262477](https://github.com/giancarloerra/socraticode/commit/0262477a9036ca55b49dbb985e3c32ebc068570e))
* **config:** reject partial file-size values ([b2b4df7](https://github.com/giancarloerra/socraticode/commit/b2b4df7ced33d8efd992a55c0e55a58514f830c2))
* **context:** exclude binary and ignored files from directory artifacts ([e703244](https://github.com/giancarloerra/socraticode/commit/e7032446f4b29f883bd1fc2a4762c38a9ba7ec87)), closes [#116](https://github.com/giancarloerra/socraticode/issues/116)
* **embeddings:** bound the Ollama connection pool ([#119](https://github.com/giancarloerra/socraticode/issues/119)) ([5be07fd](https://github.com/giancarloerra/socraticode/commit/5be07fd763d0efb06bac84a7507b23e2ce0a3e5a)), closes [#114](https://github.com/giancarloerra/socraticode/issues/114)
* **gdscript:** complete portable graph support ([eea0736](https://github.com/giancarloerra/socraticode/commit/eea0736a1679766a77c9c06b0f7e6fcbcf473274))
* **gdscript:** preserve call graph semantics ([40c47a2](https://github.com/giancarloerra/socraticode/commit/40c47a2f3e3c617a778dc0aa5cc8501cc9c6a300))
* **gdscript:** preserve escaped raw-string quotes ([bb018ed](https://github.com/giancarloerra/socraticode/commit/bb018ed32805febd672c73dd479ffd95d38d38f0))
* **gdscript:** preserve script ownership during resolution ([3fc216d](https://github.com/giancarloerra/socraticode/commit/3fc216d153459cacffeabe52f602c571232c28c9))
* **graph:** address CodeRabbit review feedback on leases, lock cleanup, and ast grammars ([fb5eb0e](https://github.com/giancarloerra/socraticode/commit/fb5eb0ee63cd4ed90cb9faff0f601398cc8696b5))
* **graph:** answer a 2015 leading :: from the crate root, never from the file's scope ([a8dd239](https://github.com/giancarloerra/socraticode/commit/a8dd23930c7095dcb6e5aa37417fdaa0e8b3e3ca))
* **graph:** apply review — semver prerelease precedence, group modifiers, unknown builder ([1d4de16](https://github.com/giancarloerra/socraticode/commit/1d4de163d05269f5b8beff2e153afdbe39fcc73f)), closes [#120](https://github.com/giancarloerra/socraticode/issues/120)
* **graph:** bind generation leases to operations ([c57aa30](https://github.com/giancarloerra/socraticode/commit/c57aa30058166be8525429d81f1692b46c40cc66))
* **graph:** carry the file a declaration gives a module, not just its name ([c681c33](https://github.com/giancarloerra/socraticode/commit/c681c3341386478aa4f4596e8f46eb3697a5cc38))
* **graph:** close impact analysis compatibility gaps ([838579f](https://github.com/giancarloerra/socraticode/commit/838579fcf50b6b5f8ac7315aa357aa14d69b6eb0))
* **graph:** count a path attribute inside an inline mod from the module dir ([10ffb80](https://github.com/giancarloerra/socraticode/commit/10ffb80eabadc96fc4be23f6dd6859619b58e947))
* **graph:** exact symbol impact traversal and declaration extraction for non-function exports ([#132](https://github.com/giancarloerra/socraticode/issues/132)) ([16cc29d](https://github.com/giancarloerra/socraticode/commit/16cc29d3c9229da9e4bbe345410b845fd9e655a9))
* **graph:** fence by the name rustc knows the crate by, and let the 2015 root branch reach its crates ([8586b88](https://github.com/giancarloerra/socraticode/commit/8586b88657d3d574d0a22dbc77f04aae9b0cd2b4))
* **graph:** forgive an earlier pass its ERRORs, not its regions ([a13d90c](https://github.com/giancarloerra/socraticode/commit/a13d90ce6cad3dd25c0430401ba74fd70e82d75f))
* **graph:** generational symbol storage, canonical reverse shards, and safe rebuild guards ([a2c2346](https://github.com/giancarloerra/socraticode/commit/a2c234639ed787917a7676fc6fceb5038288b6be))
* **graph:** handle aliased/namespace imports, same-file ambiguity, and incomplete graph signal ([22d6e64](https://github.com/giancarloerra/socraticode/commit/22d6e64c0ef75679485bc709d5be876c3a02e2bd))
* **graph:** inherit the edition a workspace declares, and gate the root prefix ([9d7b8ee](https://github.com/giancarloerra/socraticode/commit/9d7b8eed2299d1b10e39292fd5073aee0da6ccba))
* **graph:** keep an unwrapped macro pass only while recovery stays inside it ([8f0472e](https://github.com/giancarloerra/socraticode/commit/8f0472eae74d5622dccbfb300c2e5f90ea61e783))
* **graph:** keep the declaration gate off edition 2015, where the path is absolute ([7e4ad18](https://github.com/giancarloerra/socraticode/commit/7e4ad181cc3a382f0adcd1e42085116dd3b00bad))
* **graph:** keep the three markers a use declaration writes ([8e71990](https://github.com/giancarloerra/socraticode/commit/8e71990d59ce856898d776663a83510efd8598d5))
* **graph:** rank the governing manifest by depth, where the root is no depth at all ([8bbf02a](https://github.com/giancarloerra/socraticode/commit/8bbf02a1b1c1753504b4b59ef265ef65bb57fbd6))
* **graph:** reach only the crates the importing package declares ([a7af716](https://github.com/giancarloerra/socraticode/commit/a7af7161d9285cd2695a58d6cc9605ccee7f9bcc))
* **graph:** reach the crate root through super::, gate the unanchored path on a declaration ([0d0423e](https://github.com/giancarloerra/socraticode/commit/0d0423ea6060a1b4aeaa57acd50abcce7a5c745e))
* **graph:** read a leading :: by the edition that wrote it ([2ebc04e](https://github.com/giancarloerra/socraticode/commit/2ebc04ee3cf9a8a77d31d248177f5eca24b7851c))
* **graph:** read PHP includes from their AST nodes, and three smaller fixes ([027e7b1](https://github.com/giancarloerra/socraticode/commit/027e7b10257b501f079867538c91b7b02845377c)), closes [#120](https://github.com/giancarloerra/socraticode/issues/120)
* **graph:** read Rust paths from where the source writes them ([230825f](https://github.com/giancarloerra/socraticode/commit/230825fd0a7eaec69eced28b1667e340a1b0457c))
* **graph:** read what a macro body, a cfg_attr and a manifest actually declare ([43137bc](https://github.com/giancarloerra/socraticode/commit/43137bc16610b6a4ab7ae1526ffc6b9c9cd1195b))
* **graph:** resolve PHP requires and mapless-autoloader use imports, stamp the builder ([ac7fec0](https://github.com/giancarloerra/socraticode/commit/ac7fec052bb7829851a96b1d7b67ec9782535bbb)), closes [#120](https://github.com/giancarloerra/socraticode/issues/120)
* **graph:** resolve PR blockers for traversal, lifecycle, export lookup, and lexical shadowing ([4aea1f7](https://github.com/giancarloerra/socraticode/commit/4aea1f7cb145d831a060cdc1cfa49fea1c2d18f3))
* **graph:** resolve Python imports through pyproject-declared import roots ([#112](https://github.com/giancarloerra/socraticode/issues/112)) ([f836e99](https://github.com/giancarloerra/socraticode/commit/f836e993ef1613fe40bd9008ad3fb22408f219c0)), closes [#107](https://github.com/giancarloerra/socraticode/issues/107)
* **graph:** resolve Rust imports through Cargo-declared crate roots ([6d9cf35](https://github.com/giancarloerra/socraticode/commit/6d9cf35046a04d40cc3b87526ba53d6b37abf1a0))
* **graph:** schema-v1 compatibility, single watcher rebuild, and generation lifecycle cleanup ([96729d9](https://github.com/giancarloerra/socraticode/commit/96729d9d2b3f9c56ceb720c9a35d2931af7d1a31))
* **graph:** stop reading [workspace] exclude as unimportable, follow two inline forms ([e717d94](https://github.com/giancarloerra/socraticode/commit/e717d94d71d4ab29d4ae2b91f859550414308f0b))
* **graph:** take the name a module declaration puts in scope from the declaration ([fa68f4c](https://github.com/giancarloerra/socraticode/commit/fa68f4cd2c756bf1ecfc74621166940f68badfe5))
* **graph:** write the NUL separator as an escape, not a literal byte ([da9dd83](https://github.com/giancarloerra/socraticode/commit/da9dd8350ee9c5d1a00e50ce1b1306baae86592d))
* **ignore:** anchor the pattern a detected environment writes ([9cdc404](https://github.com/giancarloerra/socraticode/commit/9cdc404efe3ba7aa4ec70e28d092e753b1eeb8be))
* **ignore:** compare an environment root in forward slashes, whatever the caller wrote ([136a5ea](https://github.com/giancarloerra/socraticode/commit/136a5ea8a773843da62725e418130449095242fa)), closes [#136](https://github.com/giancarloerra/socraticode/issues/136)
* **ignore:** keep a discovered environment as the literal prefix it is ([4492299](https://github.com/giancarloerra/socraticode/commit/44922998dee7378628a0e4ff494b08b8bda475b7))
* **ignore:** read an environment marker as what it is, not as what it links to ([0b823f8](https://github.com/giancarloerra/socraticode/commit/0b823f881d469d120d1a3e6e1c4c218039827312)), closes [#136](https://github.com/giancarloerra/socraticode/issues/136)
* **ignore:** read each environment marker in the shape its tool writes ([043599f](https://github.com/giancarloerra/socraticode/commit/043599fa121b39d8e1b7cf975a1f2c527017ad44))
* **ignore:** recognise environments by their marker, not their name ([39aad31](https://github.com/giancarloerra/socraticode/commit/39aad31919cc21e88a9ebc89ec52af2b1df39c33))
* **impact:** direct reverse symbol traversal, disambiguation parameters, and schema guard ([a729b94](https://github.com/giancarloerra/socraticode/commit/a729b944fa4de11055f956839762d875a20f81d4))
* **incremental:** use exact calleeId for reverse shards, add atomic pre-check, and fix test types ([c54fe6e](https://github.com/giancarloerra/socraticode/commit/c54fe6e4bc89058beb386c9d7a0a14e5a011f2a3))
* **indexing:** complete effective profile compatibility ([77ee3c3](https://github.com/giancarloerra/socraticode/commit/77ee3c38ada9366211eee1f539cd962631c979c8))
* **indexing:** keep legacy profile reads non-mutating ([082758c](https://github.com/giancarloerra/socraticode/commit/082758ce713b979b5f386b4dccdc4cb956028886))
* **indexing:** preserve effective index profiles ([af9ebd9](https://github.com/giancarloerra/socraticode/commit/af9ebd99a395374f758b455642231425ddc1be33))
* **qdrant:** make collection setup concurrency-safe ([be82ba0](https://github.com/giancarloerra/socraticode/commit/be82ba002073217025c9945bc97dafbf2d8d45f4))
* **qdrant:** stop concurrent callers from racing to create the metadata collection ([646c15c](https://github.com/giancarloerra/socraticode/commit/646c15cfb1c5c42f01455046aa72cb222bba3d3d))
* **resolution:** preserve dotted path components and require unique suffix matches ([6e17e2f](https://github.com/giancarloerra/socraticode/commit/6e17e2f797e0ae7c98f8818b2090dd929f82f075))
* **resolution:** resolve cross-file calls using module identity, default exports, and transitive barrel chains ([5a3390c](https://github.com/giancarloerra/socraticode/commit/5a3390c87fc3ee865e2770ff753b313c6de41776))
* **review:** address PR feedback on resolution, schema upgrade, and AST extraction ([7a4d911](https://github.com/giancarloerra/socraticode/commit/7a4d911ea2ad238d34a9e664016124239ec61265))
* **store:** persist exact reverse symbol index with same-file edges and fail-closed storage errors ([69de45a](https://github.com/giancarloerra/socraticode/commit/69de45a30b4961fd4902421a667cb17cdafcc7a8))
* **store:** propagate typed StorageReadError from loadFilePayload and deleteFilePayload ([93c2bdf](https://github.com/giancarloerra/socraticode/commit/93c2bdfa8f1b00273f4740122971cc076cee99a6))
* **symbols:** a name a file's top level imports is reachable from its module ([083b410](https://github.com/giancarloerra/socraticode/commit/083b410701465eb48283d1352db3e965a5fd2ade))
* **symbols:** answer a file-scoped path with the file's top level only ([6c911ab](https://github.com/giancarloerra/socraticode/commit/6c911ab6982443297d28851cb33b9c5a9988c9b1))
* **symbols:** answer with the file when a path never leaves the inline mods ([4a5dffa](https://github.com/giancarloerra/socraticode/commit/4a5dffa89501a3b034d08e235c49c6ba930772b3))
* **symbols:** climb one module per leading `super` ([d45caf8](https://github.com/giancarloerra/socraticode/commit/d45caf8cc5b7b6ed2d11071e37f09752e04f4ca8)), closes [#147](https://github.com/giancarloerra/socraticode/issues/147)
* **symbols:** complete Rust qualified-call resolution ([7bdf1c8](https://github.com/giancarloerra/socraticode/commit/7bdf1c8fc154466f9dc27ef5c976757e9253dbc0))
* **symbols:** count the inline `mod` a `super::` path is written in ([616b3d6](https://github.com/giancarloerra/socraticode/commit/616b3d687660d8243dde8cea9eaee07656d2f083))
* **symbols:** extract top-level variable declarations, unpack destructuring, and track edge kinds ([502299b](https://github.com/giancarloerra/socraticode/commit/502299b124b48ec7c0998b7540e6b1269242bff1))
* **symbols:** give a binary its own `crate::` ([0e112fe](https://github.com/giancarloerra/socraticode/commit/0e112feb06fdf4c234b6787878d3d1c75a7e8e0c))
* **symbols:** include importedName and localAlias in seenCalls deduplication key ([e211221](https://github.com/giancarloerra/socraticode/commit/e211221d2ba5d0cf95b43edbe0df12c7290165dc))
* **symbols:** leave a path rooted in an inline `mod` unresolved ([3520786](https://github.com/giancarloerra/socraticode/commit/35207866b7354cbdd707074c91be70eece45248a))
* **symbols:** order Rust symbols by source offset, not by name ([978e841](https://github.com/giancarloerra/socraticode/commit/978e84159f6ec240a8ec48d1e1f53aea1602d044))
* **symbols:** read a `crate`-rooted binding from the crate root too ([0e06095](https://github.com/giancarloerra/socraticode/commit/0e06095c5705ab9c05114e686fd48916088b3187))
* **symbols:** read a `super`-rooted path in the parent's scope ([f0d6d70](https://github.com/giancarloerra/socraticode/commit/f0d6d70c46af4479b650af3f3d441fb08099caeb)), closes [#147](https://github.com/giancarloerra/socraticode/issues/147)
* **symbols:** read a Cargo target's root by its shape, not by a prefix ([3b3c72f](https://github.com/giancarloerra/socraticode/commit/3b3c72f9f266179b079f9c61fdbceb3aa4d25441)), closes [#147](https://github.com/giancarloerra/socraticode/issues/147)
* **symbols:** read a type qualifier in the type namespace only ([c67e1d1](https://github.com/giancarloerra/socraticode/commit/c67e1d192b8eb2396b5a8ce173d93995aafb4795))
* **symbols:** read Rust qualified calls, and resolve them by their qualifier ([f8a6cda](https://github.com/giancarloerra/socraticode/commit/f8a6cdad660f91564a795d612f25af5dd81abbb6)), closes [#143](https://github.com/giancarloerra/socraticode/issues/143) [#140](https://github.com/giancarloerra/socraticode/issues/140)
* **symbols:** read the Rust items that are not functions ([99d838e](https://github.com/giancarloerra/socraticode/commit/99d838e36451797ded512dc63fcc6fde81e01fa5)), closes [#132](https://github.com/giancarloerra/socraticode/issues/132) [#135](https://github.com/giancarloerra/socraticode/issues/135) [#135](https://github.com/giancarloerra/socraticode/issues/135)
* **symbols:** refuse an inline-mod symbol by the path, not by the spelling ([9e5a73f](https://github.com/giancarloerra/socraticode/commit/9e5a73fe4700f3310589c02765c90b08b6229aae)), closes [only_inside#4](https://github.com/giancarloerra/only_inside/issues/4)
* **symbols:** start a `crate::` path at the crate root, and fix a root-level file's parent ([ca64100](https://github.com/giancarloerra/socraticode/commit/ca6410099cfa26b1c19c2107954dec6f2a83e5ff))
* **symbols:** support namespace reexports, filter declared identifiers, and pre-flight removals ([a283099](https://github.com/giancarloerra/socraticode/commit/a283099d120b03923ab909f627436ca04a4016d8))
* **symbols:** take the Swift declaration kind from its keyword ([1db3b27](https://github.com/giancarloerra/socraticode/commit/1db3b277ade0d60b22408cb13152a4b45190145f))
* **symbols:** three answers rustc refuses, found by review ([44e7547](https://github.com/giancarloerra/socraticode/commit/44e75471d94323587729f63d28cbe33ecf75fd7d))
* **symbols:** walk a Rust module path one segment at a time ([fd71b8e](https://github.com/giancarloerra/socraticode/commit/fd71b8e7b20531dc94920743607249d83073afae))
* **watcher:** ask every created path whether it is a directory, before reading its name ([626c388](https://github.com/giancarloerra/socraticode/commit/626c388599c4b032a54da06117920757e29250c4))
* **watcher:** block queued updates during shutdown ([6b612b7](https://github.com/giancarloerra/socraticode/commit/6b612b767169b51a78da107e6b26171723404aae))
* **watcher:** classify environment marker roots ([827da28](https://github.com/giancarloerra/socraticode/commit/827da28e07ae5422a00e91b03f10f7fcf66b8af4))
* **watcher:** let an environment marker through, and rebuild the filter after each update ([d43816f](https://github.com/giancarloerra/socraticode/commit/d43816f80277514597831ae4ef7a2a9c3edc6595))
* **watcher:** reconcile once more when an environment reverses under a running update ([8d6f8e2](https://github.com/giancarloerra/socraticode/commit/8d6f8e2dec79a6c02a1ddc409211a8d72e3d768a))
* **watcher:** see an environment moved, drop the marker churn, keep the negation ([0429ccf](https://github.com/giancarloerra/socraticode/commit/0429ccfc6eb467b906a0291db4bd06dc4ba1cfb5))
* **watcher:** serialize deferred reconciliation ([37e46a8](https://github.com/giancarloerra/socraticode/commit/37e46a8171306bbfd63b36ca104cb226324d6bd7))

### Refactors

* **graph:** ask only for the declared name, since only a declaration has one ([f5fad14](https://github.com/giancarloerra/socraticode/commit/f5fad148db4e93a79bae301ccc92108d2eafc237))

### Documentation

* **changelog:** correct scraped issue references in the 1.12.0 entry ([c8d1e15](https://github.com/giancarloerra/socraticode/commit/c8d1e15b19cd4d46879e3a35c745e1027bd2b001))
* clarify compatible editor guidance ([1569802](https://github.com/giancarloerra/socraticode/commit/15698022837362445905923332473896ee915289))
* clarify native agent prerequisites ([7c84392](https://github.com/giancarloerra/socraticode/commit/7c84392b87a9fcb66862b82a63b868187d859397))
* clarify updates and host configuration ([f4cfdbb](https://github.com/giancarloerra/socraticode/commit/f4cfdbb7950cc2ff2fade9d8b81428aca9a11407))
* **developer:** document the resolveImport parameter tail and the build map helpers ([c1d0181](https://github.com/giancarloerra/socraticode/commit/c1d0181c122c469af41740ab8d935469f2bebc44)), closes [#111](https://github.com/giancarloerra/socraticode/issues/111)
* **readme:** quote the task-prefix defaults so the trailing space is visible ([c2fd929](https://github.com/giancarloerra/socraticode/commit/c2fd929a29bd19dd53f79e4fe000c2c193ec54fe))
* refresh host integration instructions ([0d0b74f](https://github.com/giancarloerra/socraticode/commit/0d0b74ffa84523220b7947b43fec44aa82487c35))
* scope editor verification steps ([ae1560e](https://github.com/giancarloerra/socraticode/commit/ae1560e4a26d37f20501579433598eff2e229443))
* **symbols:** correct why a path rooted in an inline `mod` is dropped ([b89100f](https://github.com/giancarloerra/socraticode/commit/b89100fe04f6cbffb812520d3e18bbaecc586891))
* **symbols:** say where the module-stem rule is still read by name ([ae6940b](https://github.com/giancarloerra/socraticode/commit/ae6940b2a38f30b41e911b6dd0fe4d9b4dd25f6e))
* **types:** refine SymbolEdge.localAlias documentation for imports and re-exports ([403fab2](https://github.com/giancarloerra/socraticode/commit/403fab202fa48b6abe8fb0cd8002237e37b0cffa))

### Tests

* **context:** cover ensure-time artifact regressions ([aa73217](https://github.com/giancarloerra/socraticode/commit/aa7321704cac26383379ff732532b20bfba08216))
* **e2e:** wait for explicit index completion ([7704cce](https://github.com/giancarloerra/socraticode/commit/7704cceb2f2c848558e630454ad33ebdc79e4336))
* **gdscript:** exercise parser fallback dispatch ([039089b](https://github.com/giancarloerra/socraticode/commit/039089ba5da0cbad758d30ff596269b2240811e5))
* **gdscript:** require unique project resolution ([7951e77](https://github.com/giancarloerra/socraticode/commit/7951e77553457adc1e0c5fdd8c9b82c16ccb2e65))
* **graph:** a path attribute naming a file that starts with self ([d1739bc](https://github.com/giancarloerra/socraticode/commit/d1739bc01db4efa86b17e58be718f401918fa80e))
* **graph:** assert the unanchored path where it is read, and keep the fixtures off the platform separator ([7fb1d18](https://github.com/giancarloerra/socraticode/commit/7fb1d1816d7251247aa0c2b1b25c1cc34da0dbf2))
* **graph:** cover a leading :: on a head with nothing below it ([c4dd12f](https://github.com/giancarloerra/socraticode/commit/c4dd12fb07a4e354fefde14e6063c222dbb55fbc))
* **graph:** cover the guards a mutation run found unchecked ([ccf8d6c](https://github.com/giancarloerra/socraticode/commit/ccf8d6cd5fc0a978b5dfe5d19e3f9d50ba8f4046))
* **graph:** cover the targets a manifest declares by name alone ([4b7a611](https://github.com/giancarloerra/socraticode/commit/4b7a611c06ee3c1bdfda53d429f4d28391c575ad))
* **graph:** drive the 2015 declaration-versus-use difference through the graph ([382e9e6](https://github.com/giancarloerra/socraticode/commit/382e9e6ff8e2d296dd2af0afba750ac6a615a282))
* **graph:** hold the three scope rules nothing was holding ([ee81aed](https://github.com/giancarloerra/socraticode/commit/ee81aed18e7952d313ed39c6e75eac52e403b55d))
* **graph:** let cargo judge the Rust graph, inside the suite ([6291048](https://github.com/giancarloerra/socraticode/commit/62910482a921fd20e31d339d268f6bd30f769bce))
* **graph:** pass the crate map past the two parameters main added ([56141d1](https://github.com/giancarloerra/socraticode/commit/56141d111ab24ef924511f5c19ca57959701d585))
* **graph:** prove [replace] redirects a registry name to a project crate ([5cafe70](https://github.com/giancarloerra/socraticode/commit/5cafe70ec2cc6d927c90105925c6049e72ce762d))
* **graph:** prove a [patch] keyed by a git remote leaves the registry name alone ([1a44bda](https://github.com/giancarloerra/socraticode/commit/1a44bdad54d1d6dff9a90e438b5f7d020fc363c5))
* **graph:** prove a dash-named dependency inherits under the name the source writes ([05d3b2c](https://github.com/giancarloerra/socraticode/commit/05d3b2c0ccde6a25e3fb5d46e2fc626bf13b5276))
* **graph:** prove a member's own entry inherits nothing from the workspace ([9ddf8e9](https://github.com/giancarloerra/socraticode/commit/9ddf8e9fdb10144da872da009f2936319f84d616))
* **graph:** prove the workspace decides where an inherited dependency comes from ([8d572a8](https://github.com/giancarloerra/socraticode/commit/8d572a8c388ee4bfa0d32b9643fd46c33251dd46))
* **ignore:** prove the venv half of the anchoring, which nothing held ([1a217ea](https://github.com/giancarloerra/socraticode/commit/1a217eac25ec9f242cb85cc47f06e1fe8e9f476d))
* **qdrant:** make symbol graph retry coverage deterministic ([6277fc4](https://github.com/giancarloerra/socraticode/commit/6277fc4735567e5d95045622a73ed5b233587a4f))
* **symbols:** add end-to-end contract tests on disk for symbol graph pipeline ([2d1c928](https://github.com/giancarloerra/socraticode/commit/2d1c92854e7aee357556a4694395061e44955aac))
* **symbols:** name the walk that decides which `Type` a path means ([7484713](https://github.com/giancarloerra/socraticode/commit/748471358cdb0a60bcd45aae517db75c24cece34))
* **symbols:** reach the crate boundary the walk can cross ([628c445](https://github.com/giancarloerra/socraticode/commit/628c4455be867cbb6ad986da65b3552f7fc95650))
* **watcher:** pin the environment reversal that arrives on its own ([1fd3219](https://github.com/giancarloerra/socraticode/commit/1fd32192c07618b959f828d7f1d94454346e3b68))
* **watcher:** switch fake timers inside the call that needs them, not in the hooks ([bc0360e](https://github.com/giancarloerra/socraticode/commit/bc0360e7f50b0231915a12574fbeb58a0d07213b))

## [1.12.0](https://github.com/giancarloerra/socraticode/compare/v1.11.0...v1.12.0) (2026-08-14)

### Bug Fixes

* **graph:** reject backslashes in package: URI paths ([e550edc](https://github.com/giancarloerra/socraticode/commit/e550edc2e0e5f1bd585aad779e4426a7c710fecc))
* **graph:** resolve Dart package: imports through pubspec-derived package roots ([ca7e277](https://github.com/giancarloerra/socraticode/commit/ca7e27723243fe4c13674e3e08e0fa23dd6d500f)), closes [#106](https://github.com/giancarloerra/socraticode/issues/106)
* **index:** add .dart_tool to the default ignore patterns ([06180d3](https://github.com/giancarloerra/socraticode/commit/06180d3362aee310a0c324a9c6d5fa73b3f8fc92))
* **startup:** refuse Node 26 only when the installed qdrant client breaks there ([39b1d2c](https://github.com/giancarloerra/socraticode/commit/39b1d2c8b527f15078ded86165957cf88e53c374))
* **startup:** require a full semver shape before trusting the client version ([9ab7b2e](https://github.com/giancarloerra/socraticode/commit/9ab7b2eb0e77a522d046f944dbb06af1637f3579))

### Tests

* **startup:** pin rejection of trailing garbage after a valid patch number ([54e2e14](https://github.com/giancarloerra/socraticode/commit/54e2e1444c3836f5a4fc0226f13d92107eba996f))

## [1.11.0](https://github.com/giancarloerra/socraticode/compare/v1.10.0...v1.11.0) (2026-08-05)

### Features

* **indexing:** index Stylus (.styl) files ([b941465](https://github.com/giancarloerra/socraticode/commit/b94146526620d30b0ad87b80f74f7f1ca7ee4bcc))

### Bug Fixes

* **deps:** pin @qdrant/js-client-rest to 1.18.x; restore Node 18 ([55d0721](https://github.com/giancarloerra/socraticode/commit/55d07210719aeb2c920d3ee7b7373678af4f7a71)), closes [qdrant/qdrant-js#134](https://github.com/qdrant/qdrant-js/issues/134)
* **graph:** fail closed on malformed multipart shard headers ([9147ea0](https://github.com/giancarloerra/socraticode/commit/9147ea0ac2a2fde654817508daea7023715a85b0)), closes [#104](https://github.com/giancarloerra/socraticode/issues/104)
* **graph:** label .styl files stylus instead of plaintext ([5338c0d](https://github.com/giancarloerra/socraticode/commit/5338c0d202723f34275c7abe2ac8a8c5598caade))
* **graph:** name Ruby calls from the grammar's method field ([e6891e5](https://github.com/giancarloerra/socraticode/commit/e6891e5bf5911e455fbe49a277a10d799c1f76f1))
* **graph:** single-source shard id seeds; bound the reader; review polish ([1874038](https://github.com/giancarloerra/socraticode/commit/1874038cfd964babaf1b150e2bb6dfdcf3fd8334))
* **graph:** split oversized symbol-graph shards across multiple points ([eb58826](https://github.com/giancarloerra/socraticode/commit/eb58826f5cc13baaefff18106651eae7c5ff8aab)), closes [#92](https://github.com/giancarloerra/socraticode/issues/92) [#89](https://github.com/giancarloerra/socraticode/issues/89) [#99](https://github.com/giancarloerra/socraticode/issues/99)
* **graph:** stamp shard parts with a write identity; probe part counts cheaply ([32f16d6](https://github.com/giancarloerra/socraticode/commit/32f16d6256f601ce9c62db246380d133f554bb0c))
* **graph:** stop one class from erasing a plain-JS file's symbol graph ([e68d23a](https://github.com/giancarloerra/socraticode/commit/e68d23aa5171269212d16b7e66171c386743d109))
* name each PHP call by its own callee in a fluent chain ([2bf8502](https://github.com/giancarloerra/socraticode/commit/2bf85027d8ab304556d5b5fb1ed3954fc58f8094))
* resolve PHP imports and call sites through language-aware rules ([8fd04d4](https://github.com/giancarloerra/socraticode/commit/8fd04d442dc37a0e014282d7f880689f7a0c5271))

### Documentation

* fold the MCP Toplist badge into the badge row and drop the star-history chart ([43b2c36](https://github.com/giancarloerra/socraticode/commit/43b2c36668ff7db604cd402569e56035db67e42d))

### Tests

* assert callee counts, not just the distinct set ([b08ff2a](https://github.com/giancarloerra/socraticode/commit/b08ff2ae0fa1aa4e1820f388da01d138c1f9d7ee))

## [1.10.0](https://github.com/giancarloerra/socraticode/compare/v1.9.2...v1.10.0) (2026-07-30)

### Bug Fixes

* **graph:** resolve shell source directives in the file graph ([4afd144](https://github.com/giancarloerra/socraticode/commit/4afd1446aa8173195b421092fb76270aa7651fd3)), closes [#include](https://github.com/giancarloerra/socraticode/issues/include)
* **indexer:** cap before filtering so the empty-chunk invariant actually holds ([a5d7edc](https://github.com/giancarloerra/socraticode/commit/a5d7edc1936a4f9de560e90232f512d5ea09728d))
* **indexer:** never emit chunks with empty content ([255c55d](https://github.com/giancarloerra/socraticode/commit/255c55dd0be59d40eae86c66ca1e98841276359f))
* **search:** correct the fallback docs and cover the dense-vector paths ([72a3a09](https://github.com/giancarloerra/socraticode/commit/72a3a096bcbbd0cd4dd91b1e99df066d2337f38a))
* **search:** fall back rather than compare vectors of different shape ([5db7264](https://github.com/giancarloerra/socraticode/commit/5db7264b9f57cca7e2da4cdeddb91a3b18b96a2f))
* **search:** rank cross-project results by cosine, not intra-collection rank ([38677a6](https://github.com/giancarloerra/socraticode/commit/38677a607a1b6d264d4ee75717b839f6aa1d5330)), closes [#94](https://github.com/giancarloerra/socraticode/issues/94)

### Documentation

* correct the cross-project deduplication claim in the README ([f98d2bc](https://github.com/giancarloerra/socraticode/commit/f98d2bcb9b6550a82aee5ae64c3c850ebf353072)), closes [#96](https://github.com/giancarloerra/socraticode/issues/96)

### Tests

* **search:** assert every collection requests the dense vector ([547a6e2](https://github.com/giancarloerra/socraticode/commit/547a6e2b930441a509e54606e763e0b8b13a837c))

## [1.9.2](https://github.com/giancarloerra/socraticode/compare/v1.9.1...v1.9.2) (2026-07-28)

### Bug Fixes

* **graph:** carry detected language from discovery into graph build ([e0a77c7](https://github.com/giancarloerra/socraticode/commit/e0a77c7543f64d6dd0b89e193e042ef4e43370e3))
* **graph:** count and log files skipped during code graph build ([64f466b](https://github.com/giancarloerra/socraticode/commit/64f466b3243b89871f5ed07e09ec1686e57b629d))
* **graph:** keep a symbol-graph failure recorded across incremental rebuilds ([79034e3](https://github.com/giancarloerra/socraticode/commit/79034e3ad444627f183a22acd4349baad88514d3))
* **graph:** label extensionless files by detected language in graph stats and visualization ([bcad5d2](https://github.com/giancarloerra/socraticode/commit/bcad5d2e3697465c5a107df164570c40e786f7a5))
* **graph:** log unreadable files in the incremental symbol-graph update ([874091f](https://github.com/giancarloerra/socraticode/commit/874091f0b2d1872956f8f6f8f9c4be5cb76a71a3))
* **graph:** pack symbol-graph upserts by bytes and surface persist failures ([1fb7928](https://github.com/giancarloerra/socraticode/commit/1fb7928281fd08a877eb5f0ca8eefffcb5ced0c5)), closes [#89](https://github.com/giancarloerra/socraticode/issues/89)
* **graph:** preserve a symbol-graph failure across a total build failure too ([4cd0f48](https://github.com/giancarloerra/socraticode/commit/4cd0f488f1b871809f3fdc2bea5454cd78457d40))
* **graph:** warn on symbol-level tools when the symbol graph failed to persist ([73f2ab6](https://github.com/giancarloerra/socraticode/commit/73f2ab696cfdfac6099b6629946ac7934e937c26)), closes [#89](https://github.com/giancarloerra/socraticode/issues/89)
* **watcher:** score the extensionless watch check on the shared byte window ([f971504](https://github.com/giancarloerra/socraticode/commit/f971504e1baa10ad8f866d556f6271823f246a2f))

### Documentation

* document graph-build skip accounting and discovery ordering ([61f4cd2](https://github.com/giancarloerra/socraticode/commit/61f4cd2ef5bb98757376e841671af68dd6ce3c50))
* name doRebuildGraph, not buildCodeGraph, as the symbol-graph error recorder ([0a4f9e0](https://github.com/giancarloerra/socraticode/commit/0a4f9e03d01e0a909f6fd28f4d5ae9af3dea6e35))

### Tests

* **graph:** drop a redundant conditional type; document the abandon-on-oversize choice ([d1d3a6d](https://github.com/giancarloerra/socraticode/commit/d1d3a6d9519dc385ed7d9dfb4b793c4100287d49))

## [1.9.1](https://github.com/giancarloerra/socraticode/compare/v1.9.0...v1.9.1) (2026-07-24)

### Bug Fixes

* **engines:** drop the <26 upper bound so Node 26 hits the guard, not a silent downgrade ([6d6a298](https://github.com/giancarloerra/socraticode/commit/6d6a2986ecd2cebc8495e2efe04b0db081733d36)), closes [123/#128](https://github.com/123/socraticode/issues/128) [#82](https://github.com/giancarloerra/socraticode/issues/82)

## [1.9.0](https://github.com/giancarloerra/socraticode/compare/v1.8.18...v1.9.0) (2026-07-21)

### Features

* **indexing:** index extensionless files via content-based language detection ([1304f3e](https://github.com/giancarloerra/socraticode/commit/1304f3e0467ccc2e5c7d520947a385e26b837e40))

### Bug Fixes

* **graph:** discover symlinked go.mod and lock in the ignore-filter branch ([#84](https://github.com/giancarloerra/socraticode/issues/84)) ([7b966e7](https://github.com/giancarloerra/socraticode/commit/7b966e78123fd9a9b35b5e4a102acc5381dffd13))
* **graph:** resolve Go imports when go.mod is nested in a monorepo ([#82](https://github.com/giancarloerra/socraticode/issues/82)) ([b8c2d68](https://github.com/giancarloerra/socraticode/commit/b8c2d68558088adfadd7081b718c8b73dce37383)), closes [#45](https://github.com/giancarloerra/socraticode/issues/45)

### Documentation

* document INDEX_EXTENSIONLESS and extensionless-file detection ([ac7a92b](https://github.com/giancarloerra/socraticode/commit/ac7a92b376ed472f4d086a80b1dcbdff69996e9f))

## [1.8.18](https://github.com/giancarloerra/socraticode/compare/v1.8.17...v1.8.18) (2026-06-28)

### Features

* **indexing:** map custom extensions to languages via EXTENSION_LANGUAGE_MAP ([#77](https://github.com/giancarloerra/socraticode/issues/77)) ([1c5ddf5](https://github.com/giancarloerra/socraticode/commit/1c5ddf52be635eefe95a8a228f8b6db9ecc87a04))

### Bug Fixes

* **indexing:** normalize extension casing and tighten docs/test ([#77](https://github.com/giancarloerra/socraticode/issues/77)) ([c2c616f](https://github.com/giancarloerra/socraticode/commit/c2c616f4a33b8d5ed48ad32cb1988bde2f244ec0))

### Documentation

* **embeddings:** clarify the LiteLLM provider is a proxy-server client ([#76](https://github.com/giancarloerra/socraticode/issues/76)) ([0dc244e](https://github.com/giancarloerra/socraticode/commit/0dc244e89ad50c10a01c15183cf0c6ea2fc87fa9))

## [1.8.17](https://github.com/giancarloerra/socraticode/compare/v1.8.16...v1.8.17) (2026-06-18)

### Bug Fixes

* **graph:** extract Dart abstract members and operators ([#74](https://github.com/giancarloerra/socraticode/issues/74)) ([0ab502b](https://github.com/giancarloerra/socraticode/commit/0ab502b99b25162b41657844168d1078685e5190))

## [1.8.16](https://github.com/giancarloerra/socraticode/compare/v1.8.15...v1.8.16) (2026-06-11)

### Features

* **graph:** full Dart support via tree-sitter AST ([#71](https://github.com/giancarloerra/socraticode/issues/71)) ([7bd9eb5](https://github.com/giancarloerra/socraticode/commit/7bd9eb5308eb6201515ff03f8007c512812824aa))

### Tests

* **graph:** pin graceful degradation for Dart extension types ([c5a706c](https://github.com/giancarloerra/socraticode/commit/c5a706cc718a3b0743a5451e7c735df9c6cfbfea))

## [1.8.15](https://github.com/giancarloerra/socraticode/compare/v1.8.14...v1.8.15) (2026-06-11)

### Features

* **startup:** opt-in auto-resume of all indexed projects ([#70](https://github.com/giancarloerra/socraticode/issues/70)) ([f3362bb](https://github.com/giancarloerra/socraticode/commit/f3362bbe7d36067ba5bbdb45d99f6c4d2f051f3b))

### Bug Fixes

* **startup:** keep incremental catch-up alive when watcher startup throws ([fa4dd92](https://github.com/giancarloerra/socraticode/commit/fa4dd92196dd847bfb68460df0d278f0a9b5ff8f))

## [1.8.14](https://github.com/giancarloerra/socraticode/compare/v1.8.13...v1.8.14) (2026-06-10)

### Features

* **graph:** Lua symbol/call extraction + fix discovery for whitelist .gitignore ([d4bbb6c](https://github.com/giancarloerra/socraticode/commit/d4bbb6ca1c16d0fb0f2c025303d6cdcd436682f3))

### Tests

* **graph:** add Lua extractor + whitelist-discovery tests ([8be929a](https://github.com/giancarloerra/socraticode/commit/8be929a1c2b22dd6730c71f33a499c1b78003a49))

## [1.8.13](https://github.com/giancarloerra/socraticode/compare/v1.8.12...v1.8.13) (2026-05-27)

### Documentation

* update expired Discord invite link ([71e1e0b](https://github.com/giancarloerra/socraticode/commit/71e1e0bc039119da9939ace272916814f1c222cf))

## [1.8.12](https://github.com/giancarloerra/socraticode/compare/v1.8.11...v1.8.12) (2026-05-22)

### Bug Fixes

* **graph:** normalize stored node keys during lookup for legacy cache compat ([4526ea5](https://github.com/giancarloerra/socraticode/commit/4526ea58ae332b3839019eb3f46a0eff08801bd6))
* **graph:** normalize Windows backslash paths to forward slashes ([e9ee3ea](https://github.com/giancarloerra/socraticode/commit/e9ee3ea116639fc20e19952d9f8871dafdf87599)), closes [#60](https://github.com/giancarloerra/socraticode/issues/60)

## [1.8.11](https://github.com/giancarloerra/socraticode/compare/v1.8.10...v1.8.11) (2026-05-12)

### Bug Fixes

* **index:** flush stderr before exit on Node 26+ guard ([5cd9db0](https://github.com/giancarloerra/socraticode/commit/5cd9db07e6c993c8f2fafa756415153afb26da05))
* **index:** use fs.writeSync for synchronous flush + sync exit ([69a6b74](https://github.com/giancarloerra/socraticode/commit/69a6b74b8aff6297fd297fb8f995682e72de1053))
* refuse to start on Node 26+ until qdrant-js gains undici 7 compat ([c23120e](https://github.com/giancarloerra/socraticode/commit/c23120e6c097a6036c17d7ecdf10a40061f3da36)), closes [qdrant/qdrant-js#123](https://github.com/qdrant/qdrant-js/issues/123) [qdrant/qdrant-js#128](https://github.com/qdrant/qdrant-js/issues/128) [qdrant/qdrant-js#134](https://github.com/qdrant/qdrant-js/issues/134)

## [1.8.10](https://github.com/giancarloerra/socraticode/compare/v1.8.9...v1.8.10) (2026-05-08)

### Features

* **embeddings:** add LiteLLM as a first-class embedding provider ([1708510](https://github.com/giancarloerra/socraticode/commit/1708510c16707c3d03268e77ca0bd9ef8372f9ff)), closes [#42](https://github.com/giancarloerra/socraticode/issues/42)

### Bug Fixes

* **litellm:** iterate paginated /v1/models in readiness checks ([6c67965](https://github.com/giancarloerra/socraticode/commit/6c679656285420347a08a8b1adc52aea7123e76a))

## [1.8.9](https://github.com/giancarloerra/socraticode/compare/v1.8.8...v1.8.9) (2026-05-07)

### Bug Fixes

* **qdrant:** wrap propagated client errors with operation context ([#55](https://github.com/giancarloerra/socraticode/issues/55)) ([f22b4d1](https://github.com/giancarloerra/socraticode/commit/f22b4d128fa058877dae6efce212a47ef37057b2))

## [1.8.8](https://github.com/giancarloerra/socraticode/compare/v1.8.7...v1.8.8) (2026-05-06)

### Features

* **config:** support projectId in .socraticode.json for team-shared indexes ([#53](https://github.com/giancarloerra/socraticode/issues/53)) ([2c4d55c](https://github.com/giancarloerra/socraticode/commit/2c4d55ca50ae4eb60bb365dbcbff7923db4966e3))

## [1.8.7](https://github.com/giancarloerra/socraticode/compare/v1.8.6...v1.8.7) (2026-05-06)

### Bug Fixes

* **context:** checkpoint artifact metadata after each successful index ([#52](https://github.com/giancarloerra/socraticode/issues/52)) ([2007a18](https://github.com/giancarloerra/socraticode/commit/2007a18865d31cad3be6f5e2e88f834156c5df37))

## [1.8.6](https://github.com/giancarloerra/socraticode/compare/v1.8.5...v1.8.6) (2026-05-05)

### Features

* **qdrant:** add QDRANT_COLLECTION_PREFIX env var for shared instances ([70db002](https://github.com/giancarloerra/socraticode/commit/70db002796a76596badfed86c25d5af6c0331e69))

## [1.8.5](https://github.com/giancarloerra/socraticode/compare/v1.8.4...v1.8.5) (2026-05-05)

### Bug Fixes

* **graph:** allow Go resolution for projects with golang.org/* module paths ([8c26ed8](https://github.com/giancarloerra/socraticode/commit/8c26ed8b49f8aae030d519aca3a0ab84ad07d90d))
* **graph:** resolve Go imports via go.mod module path ([c156da1](https://github.com/giancarloerra/socraticode/commit/c156da1688e4e2b8b9c1dfb042094b018131d8f7))
* **graph:** resolve Python sibling-flat imports in service-style monorepos ([8921690](https://github.com/giancarloerra/socraticode/commit/8921690d7286ba858337d2df478ef01772d6d055))

### Documentation

* add note about MCP governance and JanuScope ([bf36c0c](https://github.com/giancarloerra/socraticode/commit/bf36c0c1b7d3ceb73161afe20628cc994dca404c))

## [1.8.4](https://github.com/giancarloerra/socraticode/compare/v1.8.3...v1.8.4) (2026-05-04)

### Bug Fixes

* **graph:** pre-validate ast-grep grammar libraryPath to survive missing prebuilds ([#44](https://github.com/giancarloerra/socraticode/issues/44)) ([e6ce327](https://github.com/giancarloerra/socraticode/commit/e6ce32710acccd6cb4a241c39a3561803e0e7dbd))

## [1.8.3](https://github.com/giancarloerra/socraticode/compare/v1.8.2...v1.8.3) (2026-05-04)

### Features

* **embeddings:** add LM Studio as a first-class embedding provider ([#42](https://github.com/giancarloerra/socraticode/issues/42)) ([332ee80](https://github.com/giancarloerra/socraticode/commit/332ee800a85fd35ded4e37adabecbfdd6221d31b))

## [1.8.2](https://github.com/giancarloerra/socraticode/compare/v1.8.1...v1.8.2) (2026-05-04)

### Bug Fixes

* cover JVM annotation and Scala callable edge cases ([6a76ad4](https://github.com/giancarloerra/socraticode/commit/6a76ad478275d6e65d58d00684414f4936ef4f83))
* extract JVM symbol names from declarations ([019eba0](https://github.com/giancarloerra/socraticode/commit/019eba058356539d23d4212a9387c5821d4a3f47))

### Tests

* cover JVM annotations with parameters ([1dbc1eb](https://github.com/giancarloerra/socraticode/commit/1dbc1eb398014d418f97879a875d003c28f8b608))

## [1.8.1](https://github.com/giancarloerra/socraticode/compare/v1.8.0...v1.8.1) (2026-05-04)

### Bug Fixes

* **docs:** replace broken Marketplace badges and surface listings in main README ([8d6cb86](https://github.com/giancarloerra/socraticode/commit/8d6cb86b274132c0f65e46b3396e36a0b8e1f3cd))

## [1.8.0](https://github.com/giancarloerra/socraticode/compare/v1.7.2...v1.8.0) (2026-05-03)

### Features

* **extension:** add VS Code and Open VSX extension ([bbc6819](https://github.com/giancarloerra/socraticode/commit/bbc68199c3577c463c049199b64f36ad5ddebb66))

### Bug Fixes

* **extension:** harden review-flagged paths ([562a946](https://github.com/giancarloerra/socraticode/commit/562a946053e79e3236950bb715a30762c2853869))
* **extension:** tighten graphPanel path and line-number bounds ([c2d012f](https://github.com/giancarloerra/socraticode/commit/c2d012fe4c72704dd431b34124b3b6f3c06b485a))

### Documentation

* **extension:** add Discord badge and hosted-edition pointer ([9a197b3](https://github.com/giancarloerra/socraticode/commit/9a197b3421d30f101d832ce0de0659405c5a0df7))
* **extension:** editor-neutral marketplace README with hero, badges and benchmarks ([345c728](https://github.com/giancarloerra/socraticode/commit/345c7281d0c8df7b370f2d38d38012fdd09e2701))
* surface VS Code / Open VSX extension and Cursor Marketplace ([d9459f8](https://github.com/giancarloerra/socraticode/commit/d9459f8591fb4085f49d358b2787be91058ac79a))

## [1.7.2](https://github.com/giancarloerra/socraticode/compare/v1.7.1...v1.7.2) (2026-04-28)

### Bug Fixes

* **docker:** include api-key header in external Qdrant readiness probe ([812fcd8](https://github.com/giancarloerra/socraticode/commit/812fcd89051d284875e029396ec8e457226c0193))
* **docker:** require HTTPS for QDRANT_API_KEY; deflake no-key test ([7cdf21a](https://github.com/giancarloerra/socraticode/commit/7cdf21a96189ace11ecedcdab2d6e15a1e7fccb0))

## [1.7.1](https://github.com/giancarloerra/socraticode/compare/v1.7.0...v1.7.1) (2026-04-27)

### Bug Fixes

* **graph:** make C# namespace resolution deterministic ([fc249fd](https://github.com/giancarloerra/socraticode/commit/fc249fdfcf0afb2225fc4df711552bfa745ade86))
* **graph:** resolve C# using directives via namespace scan (closes [#33](https://github.com/giancarloerra/socraticode/issues/33)) ([0aaf3f1](https://github.com/giancarloerra/socraticode/commit/0aaf3f1d7521ccbee01142c71433d78a7442fc46))
* **graph:** tighten C# namespace regex; capture nested declarations ([ea69a72](https://github.com/giancarloerra/socraticode/commit/ea69a721459039b9995e93c3d6a094327ffcb7a4)), closes [#34](https://github.com/giancarloerra/socraticode/issues/34)

## [1.7.0](https://github.com/giancarloerra/socraticode/compare/v1.6.1...v1.7.0) (2026-04-27)

### Features

* **impact:** add symbol-level call graph and Impact Analysis tools ([c356c42](https://github.com/giancarloerra/socraticode/commit/c356c42f4fa6dbcee51eb3e0cd4afb1ac04dd6f9))
* **impact:** close gaps from review — Phase F API, scale + integration tests, language coverage ([2d686a2](https://github.com/giancarloerra/socraticode/commit/2d686a2688946f6a6d2f6cb562ebfe0aae0b7569))
* **impact:** wire Phase F into watcher; fix prototype-key crash; add real scale test ([4e41b46](https://github.com/giancarloerra/socraticode/commit/4e41b4604ebf2c1a8a23638e8f401e91719d6b8e))
* **visualize:** add interactive HTML graph explorer; British-English doc sweep ([50d8853](https://github.com/giancarloerra/socraticode/commit/50d8853ea6ee91bf8832d3c10e8da7d8d4bac98e))
* **visualize:** symbol view as focus graph; UX polish & stats consistency ([e4da769](https://github.com/giancarloerra/socraticode/commit/e4da76979e32f1430767ef3e3069d38a8686e738))

### Bug Fixes

* **visualize:** use function replacers so vendored assets containing $& survive intact ([081606f](https://github.com/giancarloerra/socraticode/commit/081606f9e2133a273ae0ea9c1a758bb2d3a3be93))

### Documentation

* add workflow examples to Context Artifacts section ([2ad7b3d](https://github.com/giancarloerra/socraticode/commit/2ad7b3db5dbe902247daf0231952142fad24fa6b))
* **readme:** surface impact analysis & portability; fix Claude Code install ([9d11397](https://github.com/giancarloerra/socraticode/commit/9d113975dcdfdd000ba5c17478f02aa2b29d932e))

## Unreleased

### Features

* **Impact Analysis & symbol-level call graph.** Four new MCP tools that go one level deeper than the file-import graph by tracking which functions call which:
  * `codebase_impact` — return the **blast radius** for a file or symbol (every file that transitively calls into it). Use BEFORE refactoring, renaming, or deleting code.
  * `codebase_flow` — trace forward execution flow from an entry point. With no args, returns auto-detected entry points (orphan files, conventional names like `main()`, framework routes like `app.get(...)`, tests).
  * `codebase_symbol` — 360° view of one symbol: definition, callers, callees with confidence levels.
  * `codebase_symbols` — list symbols in a file or search by name across the project.
* **Sharded Qdrant storage** for the symbol graph: 27 name shards keyed by first lowercased character, 256 reverse-call file shards keyed by SHA1 first byte. Designed to scale to 100k+ files / 1M+ symbols with bounded memory via an LRU per-file payload cache.
* **18-language symbol & call extraction**: TypeScript / JavaScript / TSX, Python, Go, Rust, Java, Kotlin, Scala, C#, C, C++, Ruby, PHP, Swift, Bash + a regex fallback for Dart/Lua/Svelte/Vue.
* **Symbol graph builds automatically** alongside the file-import graph during `codebase_index` and `codebase_graph_build`. `codebase_graph_status` now reports symbol graph stats (files / symbols / edges / unresolved%).
* **Symbol graph removed** automatically when `codebase_graph_remove` is called.

### Bug Fixes

* **Java/Kotlin/Swift/Scala symbol extraction silently failed.** ast-grep throws "Invalid Kind" for grammars where a queried node kind doesn't exist (e.g. `object_declaration` is Kotlin-only, not Java). The outer try/catch in `extractSymbolsAndCalls` swallowed the error and returned only the `<module>` symbol, so 17 of 20 supported languages could regress without any test failure. Fixed via a `safeFindAll(node, kind)` wrapper applied to all 36 call sites in `services/graph-symbols.ts`. Added 14 per-language regression tests covering Rust, Java/Kotlin/Scala, C#, C/C++, Ruby, PHP, Swift, Bash, and the regex fallback path.
* **Symbol graph crashed on prototype-key collisions** (e.g. a method named `constructor`, `toString`, or `hasOwnProperty`). The shard maps used `shard[name]` bracket access on a plain `{}`, which returned `Object.prototype.constructor` (a function) and threw `existing.push is not a function` during persistence. Fixed by guarding all shard reads with `Object.hasOwn` in `services/code-graph.ts` and `services/symbol-graph-incremental.ts`. Added a regression test in `tests/integration/symbol-graph-incremental.test.ts`.
* **`tests/unit/logger.test.ts` was order-dependent on the shell environment.** `currentLevel` was frozen at module load, so `SOCRATICODE_LOG_LEVEL=debug` in the developer shell broke the "does not emit debug at info level" assertion. `services/logger.ts` now exposes `setLogLevel` / `getLogLevel`, and the test pins the level in `beforeEach` / restores in `afterEach`.

### Interactive Graph Explorer

* **Interactive HTML graph viewer** — `codebase_graph_visualize` now accepts a `mode` parameter. Default `"mermaid"` keeps the existing text-diagram behaviour; new `"interactive"` mode generates a self-contained HTML page (vendored Cytoscape.js + Dagre — no CDN, works offline) and opens it in the user's default browser via the `open` npm package. The page includes:
  * **File view** (every source file as a node, imports as edges, language colour-coded, circular deps highlighted in red)
  * **Symbol view** toggle (functions / classes / methods as nodes, call edges between them — available when the symbol graph fits under the embed caps of 20k symbols / 60k call edges; above that the file view remains and a banner directs users to `codebase_impact` for symbol-level queries)
  * **Sidebar** with imports / dependents / per-file symbols (first 30 shown, link to `codebase_symbols` for the rest) + action buttons for blast radius and call flow
  * **Right-click** a node → highlight its blast radius (reverse-transitive closure)
  * Live search, six Cytoscape layouts (Dagre / force / concentric / breadth-first / grid / circle), PNG export, hover tooltips
  * `open: false` parameter skips auto-launch — just returns the file path (useful in headless environments)
* **`open` added as a runtime dependency** for cross-platform browser launching (macOS, Linux, Windows).
* **Vendored Cytoscape.js 3.30.2 + Dagre 0.8.5 + cytoscape-dagre 2.5.0** under `src/assets/` (copied to `dist/assets/` on build). Total ≈ 650 KB; inlined into the HTML at generation time — zero network dependency at view time.

### Performance

* **Per-file incremental symbol-graph updates wired into the watcher / `codebase_update`** (Phase F). When a `SymbolGraphMeta` already exists for the project AND ≤ 50 files changed, `services/indexer.ts` now calls `rebuildGraph(path, { skipSymbolGraph: true })` plus `updateChangedFilesSymbolGraph(...)`, which patches only the affected name shards (≤ 27) and reverse-call shards (≤ 256). Above the threshold or on first index it falls back to a full rebuild. End-to-end measurement on a 1000-file synthetic repo: full rebuild **6.55 s**, single-file Phase F update **197 ms** (≈33×). See `DEVELOPER.md` § "Real-world benchmark numbers" and `tests/integration/symbol-graph-scale.test.ts`.


## [1.6.1](https://github.com/giancarloerra/socraticode/compare/v1.6.0...v1.6.1) (2026-04-17)

### Documentation

* add Zed support, per-IDE instruction paths, and strengthen graph triggers ([270d402](https://github.com/giancarloerra/socraticode/commit/270d402f48f6a87e966120ce264bbacd0a19c9a7))

## [1.6.0](https://github.com/giancarloerra/socraticode/compare/v1.5.0...v1.6.0) (2026-04-16)

### Features

* support global config fallback and configurable batch size ([9d04c44](https://github.com/giancarloerra/socraticode/commit/9d04c4443a7b0892548868fe04e59f9a35e43dcf))

### Bug Fixes

* resolve relative paths for global config fallback and strict batch size validation ([49b5b35](https://github.com/giancarloerra/socraticode/commit/49b5b35bff2809c17f1096cb62db7670503594aa))

### Documentation

* add CodeRabbit review expectations to PR template and contributing guide ([afd2da2](https://github.com/giancarloerra/socraticode/commit/afd2da2771e5ebe9cd81e391179adb769463ddb8))
* add Discord community, Cloud section, and tool portability to README ([a8b069a](https://github.com/giancarloerra/socraticode/commit/a8b069a900d5a4a20023b995ea0ecfe6b237cb7b))

## [1.5.0](https://github.com/giancarloerra/socraticode/compare/v1.4.1...v1.5.0) (2026-04-13)

### Features

* multi-platform plugin support (Cursor, Codex, Gemini CLI, VS Code) ([529d1b2](https://github.com/giancarloerra/socraticode/commit/529d1b2a642d9681ffce437cb2f902efa5aa7e6f))

### Bug Fixes

* correct spelling of "visualize" in GEMINI.md and update Codex installation instructions in README.md ([b2333b5](https://github.com/giancarloerra/socraticode/commit/b2333b574c3a978c6f3f5d6645e578b5d5bf03dc))

### Documentation

* consolidate README ([61060d5](https://github.com/giancarloerra/socraticode/commit/61060d51538a6f9fee550b7cda7f62ac47f07518))
* consolidate README — add feature comparison table and streamline sections ([efec8dd](https://github.com/giancarloerra/socraticode/commit/efec8dd29adb9da2c3308f1e3c470663c36773db))

## [1.4.1](https://github.com/giancarloerra/socraticode/compare/v1.4.0...v1.4.1) (2026-04-12)

### Bug Fixes

* address CodeRabbit PR review feedback ([00f7be1](https://github.com/giancarloerra/socraticode/commit/00f7be169c94661a098fff5e9354746823db1630))
* address CodeRabbit review findings ([bb5e6c3](https://github.com/giancarloerra/socraticode/commit/bb5e6c3e198effb1809d0a6c5286a34f8da0df68))

## [1.4.0](https://github.com/giancarloerra/socraticode/compare/v1.3.2...v1.4.0) (2026-04-12)

### Features

* branch-aware collection naming via SOCRATICODE_BRANCH_AWARE ([3a4139d](https://github.com/giancarloerra/socraticode/commit/3a4139d71426e7097a0b897db47dce99c5fac5b4)), closes [#19](https://github.com/giancarloerra/socraticode/issues/19)
* linked projects support via .socraticode.json and SOCRATICODE_LINKED_PROJECTS ([61e868c](https://github.com/giancarloerra/socraticode/commit/61e868cf9ef484cc83777d302094b10dd48ec5e3)), closes [#20](https://github.com/giancarloerra/socraticode/issues/20)
* multi-collection search with client-side RRF fusion and deduplication ([ad8db7f](https://github.com/giancarloerra/socraticode/commit/ad8db7f0db53bc0425e26282313706a8099fb792)), closes [#20](https://github.com/giancarloerra/socraticode/issues/20) [#19](https://github.com/giancarloerra/socraticode/issues/19) [#19](https://github.com/giancarloerra/socraticode/issues/19) [#20](https://github.com/giancarloerra/socraticode/issues/20)

### Bug Fixes

* address CodeRabbit review feedback on tests ([f09f417](https://github.com/giancarloerra/socraticode/commit/f09f417c6ec5446482b3fd7dc069b31435e7b81d))
* address remaining CodeRabbit production code issues ([f745d59](https://github.com/giancarloerra/socraticode/commit/f745d59ddd5baa722c49f2183bc2b922b630711d))
* linked projects use base hash without branch suffix ([fc3c298](https://github.com/giancarloerra/socraticode/commit/fc3c2988fa44c4441f2bddd209c4a55d1e4d8a1b))
* provide git identity for temp repo commits in CI ([ad2e3b9](https://github.com/giancarloerra/socraticode/commit/ad2e3b9ea16f24a39c7f0122c2388eaa4ca442a9))
* resolve JVM imports in multi-module Maven/Gradle projects ([5a734eb](https://github.com/giancarloerra/socraticode/commit/5a734eb301e9f9f53724be0da6818afa6927758f))
* update path handling and type imports in indexer and query tools ([096f59d](https://github.com/giancarloerra/socraticode/commit/096f59da130b155b435b291be85b212c78ae25fa))
* use self-contained temp git repos in branch-aware tests ([ffa8e95](https://github.com/giancarloerra/socraticode/commit/ffa8e95bdf00f2a245bbd181dec0ea5fbbec6804))

### Documentation

* add cross-project and branch-aware highlights to intro and Why SocratiCode ([24faa10](https://github.com/giancarloerra/socraticode/commit/24faa1075b77f88e63c785afb42c5bcd9538767d))
* add cross-project search and branch-aware indexing documentation ([76e3ff5](https://github.com/giancarloerra/socraticode/commit/76e3ff5f59720402bbbe07819ed69e6c93976f43))
* add OpenCode setup instructions to README ([0896164](https://github.com/giancarloerra/socraticode/commit/0896164442e340c234f37437cae11ebc65b139f5)), closes [#18](https://github.com/giancarloerra/socraticode/issues/18)

### Tests

* add includeLinked and searchMultipleCollections tests ([bf93e4a](https://github.com/giancarloerra/socraticode/commit/bf93e4a992ae39d2030a1452c60b8613e72b4d2e))

## [1.3.2](https://github.com/giancarloerra/socraticode/compare/v1.3.1...v1.3.2) (2026-03-26)

### Bug Fixes

* change SessionStart hook type from prompt to command ([72e4a5f](https://github.com/giancarloerra/socraticode/commit/72e4a5f9983b0169044af6bac411e909398559aa)), closes [#16](https://github.com/giancarloerra/socraticode/issues/16)

## [1.3.1](https://github.com/giancarloerra/socraticode/compare/v1.3.0...v1.3.1) (2026-03-24)

### Bug Fixes

* add prepublishOnly script to ensure dist/ is rebuilt before publish ([2f5b410](https://github.com/giancarloerra/socraticode/commit/2f5b410a04eb8be6e76a18e19dcfa0c169fdd144))

## [1.3.0](https://github.com/giancarloerra/socraticode/compare/v1.2.0...v1.3.0) (2026-03-19)

### Features

* add CSS [@import](https://github.com/import) tracking and path alias resolution to dependency graph ([c7e160c](https://github.com/giancarloerra/socraticode/commit/c7e160cb5ca0c5bd6e0ba9e2a258587c106fbab5))

### Bug Fixes

* add stylus to CSS resolution cases and getAstGrepLang mapping ([f80eec4](https://github.com/giancarloerra/socraticode/commit/f80eec476afc3c3979214ca2a331f08eb0cee0c8))

### Documentation

* update language support and graph docs for CSS [@import](https://github.com/import) and path aliases ([f4c5518](https://github.com/giancarloerra/socraticode/commit/f4c5518453afd3752ea4777419b5b04036ffd07d))

## [1.2.0](https://github.com/giancarloerra/socraticode/compare/v1.1.3...v1.2.0) (2026-03-18)

### Features

* add env support for controlling indexing of dotfiles ([7265247](https://github.com/giancarloerra/socraticode/commit/7265247d838b1792242a7ad082e6a35ec0759ce2))
* add Svelte and Vue import parsing to dependency graph ([4c2bd0c](https://github.com/giancarloerra/socraticode/commit/4c2bd0cc539e1fc170d019e073517b638ebbb294))
* auto-infer port from QDRANT_URL for reverse proxy support ([507d823](https://github.com/giancarloerra/socraticode/commit/507d823336a5340ea1c0bbba3b39acef9a1a35e0))

### Bug Fixes

* only call ensureOllamaReady when using Ollama provider ([#8](https://github.com/giancarloerra/socraticode/issues/8)) ([4d255f5](https://github.com/giancarloerra/socraticode/commit/4d255f50ee46e75aa2e1b23ef48e9809dc6b80d7)), closes [#7](https://github.com/giancarloerra/socraticode/issues/7)

### Documentation

* add npx cache update instructions for MCP-only install ([4cd113b](https://github.com/giancarloerra/socraticode/commit/4cd113b1e9e3776d127cd16545b9c048f353daf8))
* add Svelte/Vue to code graph language list ([7b72cf0](https://github.com/giancarloerra/socraticode/commit/7b72cf0363797ec7996e4b417abbfb538c6a1b78))

## [1.1.3](https://github.com/giancarloerra/socraticode/compare/v1.1.2...v1.1.3) (2026-03-16)

### Bug Fixes

* use relative paths for index keys to support shared worktree indexes ([505fbd7](https://github.com/giancarloerra/socraticode/commit/505fbd722bdb5cc310f7406df88a436e682a3b8b))

### Documentation

* add auto-update instructions for Claude Code plugin ([b26038a](https://github.com/giancarloerra/socraticode/commit/b26038a8b184fc63e7315d8d4a5cf0af3e37ae31))

## [1.1.2](https://github.com/giancarloerra/socraticode/compare/v1.1.1...v1.1.2) (2026-03-16)

### Bug Fixes

* correct hooks.json format, remove explicit hooks path, and improve install docs ([db69a2d](https://github.com/giancarloerra/socraticode/commit/db69a2d9b4e63324746741cf8b29931e81d652da))

## [1.1.1](https://github.com/giancarloerra/socraticode/compare/v1.1.0...v1.1.1) (2026-03-16)

### Bug Fixes

* correct Claude Code plugin install commands and add marketplace.json ([157b353](https://github.com/giancarloerra/socraticode/commit/157b353bc47e519a35561488967f01107de5b380))

## [1.1.0](https://github.com/giancarloerra/socraticode/compare/v1.0.1...v1.1.0) (2026-03-15)

### Features

* add Claude Code plugin with skills, agent, and MCP bundling ([31e5d74](https://github.com/giancarloerra/socraticode/commit/31e5d748bc65681686642e19252282a440785520))
* add SOCRATICODE_PROJECT_ID env var for shared indexes across directories ([fadfd8a](https://github.com/giancarloerra/socraticode/commit/fadfd8a80e6d33925fd071272a01d5132d7148cd))

### Documentation

* add Claude Code worktree auto-detection to git worktrees section ([d7c32d1](https://github.com/giancarloerra/socraticode/commit/d7c32d1435021172762531860350f38f83173edf))
* add git worktrees section to README ([3cad30a](https://github.com/giancarloerra/socraticode/commit/3cad30a6509837af2346fe6e83c7ec3aadc04900))
* add multi-agent collaboration as a featured capability ([72c7ce0](https://github.com/giancarloerra/socraticode/commit/72c7ce05f840b2870e83182ad83e4b0ee1938bef))

## [1.0.1](https://github.com/giancarloerra/socraticode/compare/v1.0.0...v1.0.1) (2026-03-04)

### Bug Fixes

* add mcpName and read version dynamically from package.json ([88c0e8f](https://github.com/giancarloerra/socraticode/commit/88c0e8fee39c7fb733bdec4657d2eaf2c355292e))
