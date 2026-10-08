// LLF-72 (Forge-R1): renderer fidelity — static + pure-logic checks.
//  - quality.js is wired in (index.html order, engine/scene_swap/menu hooks)
//  - sRGB output, ACES tone mapping, PMREM + RoomEnvironment, composer passes are present
//  - tier presets (shadow sizes, SAO on high) and auto-quality decision rules (20 ms / 9 ms / 5 s)
//  - Phong->Standard shim, per-scene tuning, options-menu entry
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { srcFiles, readAllSource, ROOT } = require('./_src');

let failures = 0;
function check(name, cond, extra) {
    if (cond) console.log('PASS', name);
    else { failures++; console.error('FAIL', name, extra || ''); }
}

const qPath = path.join(ROOT, 'src/core/quality.js');
check('src/core/quality.js exists', fs.existsSync(qPath));
try { execFileSync(process.execPath, ['--check', qPath]); check('quality.js passes node --check', true); }
catch (e) { check('quality.js passes node --check', false); }

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const all = readAllSource();
const q = fs.readFileSync(qPath, 'utf8');
const files = srcFiles();

// ---- load order -----------------------------------------------------------------------------
const pos = s => html.indexOf(s);
check('three r128 loads before the postprocessing scripts', pos('three.js/r128/three.min.js') >= 0 && pos('three.js/r128/three.min.js') < pos('postprocessing/EffectComposer.js'));
['environments/RoomEnvironment.js', 'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js', 'postprocessing/ShaderPass.js',
    'postprocessing/UnrealBloomPass.js', 'postprocessing/SAOPass.js', 'shaders/CopyShader.js', 'shaders/LuminosityHighPassShader.js',
    'shaders/SAOShader.js', 'shaders/DepthLimitedBlurShader.js', 'shaders/UnpackDepthRGBAShader.js', 'shaders/GammaCorrectionShader.js'
].forEach(f => check('index.html loads three@0.128.0 examples/js/' + f,
    html.includes('cdn.jsdelivr.net/npm/three@0.128.0/examples/js/' + f)));
check('shaders load before the passes that need them', pos('shaders/CopyShader.js') < pos('postprocessing/EffectComposer.js') && pos('shaders/SAOShader.js') < pos('postprocessing/SAOPass.js'));
check('quality.js loads after scenes and before src/robot/', files.indexOf('src/core/quality.js') > files.indexOf('src/scenes/wild_west.js') &&
    files.indexOf('src/core/quality.js') < files.indexOf('src/robot/kinematics.js'));
check('main.js still loads last', files[files.length - 1] === 'src/main.js');

// ---- renderer setup -------------------------------------------------------------------------
check('output encoding is linear (scene colours are authored for linear; sRGB washed them out)', /renderer\.outputEncoding\s*=\s*THREE\.LinearEncoding/.test(q));
check('no tone mapping (keeps authored colours)', /renderer\.toneMapping\s*=\s*THREE\.NoToneMapping/.test(q));
check('exposure is set per scene', /toneMappingExposure\s*=\s*T\.exposure/.test(q));
check('PMREMGenerator + RoomEnvironment build the env map', /new THREE\.PMREMGenerator\(renderer\)/.test(q) && /new THREE\.RoomEnvironment\(\)/.test(q) && /fromScene\(/.test(q));
check('env reflections go to metallic materials only (no scene-wide environment)',
    !/scene\.environment\s*=\s*QUALITY\.envTex/.test(q) && /qualityEnvSweep/.test(q) && /metalness \|\| 0\) > 0\.3/.test(q));
check('EffectComposer has RenderPass, SAOPass, UnrealBloomPass (strength 0.6) and no gamma pass',
    /new THREE\.RenderPass\(/.test(q) && /new THREE\.SAOPass\(/.test(q) && /new THREE\.UnrealBloomPass\(new THREE\.Vector2\([^)]*\), 0\.6/.test(q) && !/new THREE\.ShaderPass\(THREE\.GammaCorrectionShader\)/.test(q));
check('shadow camera is fitted to computePlayBounds each build', /qualityFitShadow/.test(q) && /computePlayBounds\(\)/.test(q));

// ---- engine wiring --------------------------------------------------------------------------
check('engine.init calls qualityInit()', /qualityInit\(\)/.test(fs.readFileSync(path.join(ROOT, 'src/core/engine.js'), 'utf8')));
check('animate renders through qualityRender()', /qualityRender\(\)/.test(fs.readFileSync(path.join(ROOT, 'src/core/engine.js'), 'utf8')));
check('no bare renderer.render(scene, camera) left in the animate loop', !/\n\s*renderer\.render\(scene, camera\);\s*\n\s*\}\s*$/m.test(fs.readFileSync(path.join(ROOT, 'src/core/engine.js'), 'utf8')));
check('buildScene calls qualityOnSceneBuilt()', /qualityOnSceneBuilt\(currentScene\)/.test(fs.readFileSync(path.join(ROOT, 'src/core/scene_swap.js'), 'utf8')));
check('options menu has a QUALITY entry (left/right/click + label)',
    /optionsItems\s*=\s*\[[^\]]*'QUALITY'/.test(all) && (fs.readFileSync(path.join(ROOT, 'src/core/menu.js'), 'utf8').match(/qualityCycle\(/g) || []).length >= 3 &&
    /qualityLabel\(\)/.test(fs.readFileSync(path.join(ROOT, 'src/core/menu.js'), 'utf8')));
check('quality persistence is try/catch-wrapped localStorage', /try\s*\{[^}]*localStorage\.getItem/.test(q) && /try\s*\{\s*window\.localStorage\.setItem/.test(q));

// ---- pure logic: load quality.js in a vm (top level only declares, so no THREE needed) ----------
const ctx = { window: { localStorage: null, devicePixelRatio: 1 }, console };
vm.createContext(ctx);
let loaded = true;
try { vm.runInContext(q + '\n;this.__q = { QUALITY_PRESETS, QUALITY_TIERS, QUALITY_MODES, qualityDecide, qualityMedian, qualityCycleMode, qualityLabel, qualityTuning, QUALITY_SCENE_TUNING, QUALITY };', ctx); }
catch (e) { loaded = false; console.error(e); }
check('quality.js loads in a bare vm without THREE (declare-only top level)', loaded);
const Q = ctx.__q || {};
if (loaded) {
    check('tiers are low/med/high/ultra', JSON.stringify(Q.QUALITY_TIERS) === JSON.stringify(['low', 'med', 'high', 'ultra']));
    check('mode list is Auto/Low/Med/High/Ultra', JSON.stringify(Q.QUALITY_MODES) === JSON.stringify(['auto', 'low', 'med', 'high', 'ultra']));
    check('shadow map: off on low, 1024 on med, 2048 on high', Q.QUALITY_PRESETS.low.shadow === 0 && Q.QUALITY_PRESETS.med.shadow === 1024 && Q.QUALITY_PRESETS.high.shadow === 2048);
    check('post-processing (bloom/SAO) is off on every tier: it haloed and blacked out scenes', ['low','med','high','ultra'].every(t => !Q.QUALITY_PRESETS[t].bloom && !Q.QUALITY_PRESETS[t].sao));
    check('instance budget grows with tier', Q.QUALITY_PRESETS.low.budget < Q.QUALITY_PRESETS.med.budget && Q.QUALITY_PRESETS.med.budget < Q.QUALITY_PRESETS.high.budget);
    check('median helper', Q.qualityMedian([5, 1, 3]) === 3 && Q.qualityMedian([1, 2, 3, 4]) === 2.5 && Q.qualityMedian([]) === 0);
    // auto rules
    check('steps down when median > 20 ms', Q.qualityDecide(25, 'high', 100000, 0, 0) === 'med');
    check('steps up when median < 9 ms', Q.qualityDecide(6, 'med', 100000, 0, 0) === 'high');
    check('holds between 9 and 20 ms', Q.qualityDecide(14, 'med', 100000, 0, 0) === 'med');
    check('max one step per 5 s', Q.qualityDecide(40, 'high', 3000, 0, 0) === 'high' && Q.qualityDecide(40, 'high', 5000, 0, 0) === 'med');
    check('never below low / above ultra', Q.qualityDecide(99, 'low', 99999, 0, 0) === 'low' && Q.qualityDecide(1, 'ultra', 99999, 0, 0) === 'ultra');
    check('hysteresis: no step up inside the no-up window', Q.qualityDecide(4, 'med', 10000, 0, 30000) === 'med' && Q.qualityDecide(4, 'med', 30000, 0, 30000) === 'high');
    check('mode cycling wraps both ways', Q.qualityCycleMode('ultra', 1) === 'auto' && Q.qualityCycleMode('auto', -1) === 'ultra' && Q.qualityCycleMode('low', 1) === 'med');
    check('label shows auto tier', /QUALITY: AUTO \(MED\)/.test(Q.qualityLabel()));
    check('per-scene tuning has an entry for all 11 scenes + default',
        ['kyoto_train', 'flight_sim', 'moon_rocket', 'waterworks', 'tower_build', 'coastal_city', 'desert', 'space', 'city', 'forest', 'wild_west', 'default']
            .every(n => Q.QUALITY_SCENE_TUNING[n] && Q.QUALITY_SCENE_TUNING[n].exposure > 0 && Q.QUALITY_SCENE_TUNING[n].lightScale >= 1 - 1e-9));
    check('qualityTuning falls back to default', Q.qualityTuning('nope').exposure === 1.0);
}

// ---- Phong -> Standard shim -----------------------------------------------------------------
{
    class Std { constructor(p) { Object.assign(this, p); this.userData = {}; } }
    class Phong { }
    const sandbox = { window: { THREE: null }, console };
    const THREE = { MeshStandardMaterial: Std, MeshPhongMaterial: Phong };
    sandbox.THREE = THREE; sandbox.window.THREE = THREE;
    vm.createContext(sandbox);
    vm.runInContext(q + '\n;qualityInstallMaterialShim();', sandbox);
    const m = new THREE.MeshPhongMaterial({ color: 0xff0000, shininess: 100, specular: 0x111111 });
    check('shim: MeshPhongMaterial now builds a standard material', m instanceof Std && m.color === 0xff0000);
    check('shim: shininess/specular dropped, mapped to roughness', m.shininess === undefined && m.specular === undefined && m.roughness >= 0.2 && m.roughness < 0.5);
    check('shim: env intensity set', m.envMapIntensity > 0 && m.envMapIntensity <= 1);
}


if (failures) { console.error(failures + ' check(s) failed'); process.exit(1); }
console.log('LLF-72 renderer fidelity checks passed');
