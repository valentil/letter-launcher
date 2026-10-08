// Letter Launcher — src/core/menu.js
// Menus + input: main/scenes/options menus, setMenuScreen state machine, selectCurrentScene (driven by window.SCENES), controls hint, keyboard/mouse handlers.
// Split out of index.html by LLF-67 (code moved verbatim). Classic <script>: shares
// top-level globals with the other src/ files; load order is set in index.html.

        // W3: Context-aware controls hint. Called cheaply each frame; only touches the
        // DOM when the game state actually changes, so a new player always sees what to
        // do (and how to reach the scene selector) without per-frame layout churn.
        let _hintState = null;
        function updateControlsHint() {
            const el = document.getElementById('controlsHint');
            if (!el) return;
            let state, html;
            if (gameStarted && typeof gameMode !== 'undefined' && gameMode) {
                state = 'wordquest:' + gameMode.name;
                html = '<b>' + gameMode.name + '</b> &nbsp;·&nbsp; type <b>words</b> the scene understands — the glowing box shows your typing &nbsp;·&nbsp; ' +
                       '<span class="key">Space</span> clears &nbsp;·&nbsp; <span class="key">Esc</span> menu';
            } else if (gameStarted) {
                state = 'game';
                html = 'Type <span class="key">A</span>–<span class="key">Z</span> / <span class="key">0</span>–<span class="key">9</span> to launch letters &nbsp;·&nbsp; ' +
                       '<span class="key">Space</span> slow-mo &nbsp;·&nbsp; <b>Middle-click</b> a letter to explode &nbsp;·&nbsp; ' +
                       '<b>Right-drag</b> a firework rocket &nbsp;·&nbsp; <span class="key">Esc</span> menu';
            } else if (inScenesMenu) {
                state = 'scenes';
                html = '<b>Scene selector</b> &nbsp;·&nbsp; top shelf = <b>word-quest games</b>, bottom = classic toys &nbsp;·&nbsp; <span class="key">←</span><span class="key">↑</span><span class="key">↓</span><span class="key">→</span> browse &nbsp;·&nbsp; <span class="key">Enter</span> or <b>click</b> to load';
            } else if (inOptionsMenu) {
                state = 'options';
                html = '<span class="key">↑</span><span class="key">↓</span> pick option &nbsp;·&nbsp; <span class="key">←</span><span class="key">→</span> change value &nbsp;·&nbsp; <span class="key">Enter</span> on BACK to return';
            } else {
                state = 'menu';
                html = '<span class="key">↑</span><span class="key">↓</span> move &nbsp;·&nbsp; <span class="key">Enter</span> or <b>click</b> to select &nbsp;·&nbsp; choose <b>SCENES</b> to pick a map';
            }
            if (state !== _hintState) {
                _hintState = state;
                el.innerHTML = html;
            }
        }

        function createScenesMenu() {
            inScenesMenu = true;
            syncScenesFromRegistry();   // LLF-67: shelves built from window.SCENES
            menuMeshes.forEach(m => scene.remove(m));
            menuMeshes = [];
            scenesMenuMeshes = [];
            tvMeshes = [];
            tvGrid = [];

            // Background Architect Scene: TV wall
            const deskGeo = new THREE.BoxGeometry(10, 0.5, 4);
            const deskMat = new THREE.MeshPhongMaterial({ color: 0x333333 });
            const desk = new THREE.Mesh(deskGeo, deskMat);
            desk.position.set(0, -2, 5);
            scene.add(desk);
            scenesMenuMeshes.push(desk);

            const chairGeo = new THREE.BoxGeometry(2, 4, 2);
            const chairMat = new THREE.MeshPhongMaterial({ color: 0x111111 });
            const chair = new THREE.Mesh(chairGeo, chairMat);
            chair.position.set(0, -1, 8);
            scene.add(chair);
            scenesMenuMeshes.push(chair);

            // Two labeled shelves, no empty screens: WORD QUEST game levels on
            // top (gold, bigger, tagged), classic sandbox toys below, BACK at
            // the bottom. tvGrid is jagged: one row per shelf.
            function addHeader(text, y, colorHex) {
                if (!font) return;
                const h = makeTextLabel(text, 0.42, colorHex);
                h.position.set(0, y, 0.1);
                scene.add(h);
                scenesMenuMeshes.push(h);
            }
            addHeader('WORD QUEST — the scene obeys what you type', 10.6, 0xffd700);
            addHeader('SANDBOX — classic baby-smash letter toys', 6.2, 0x00ff88);

            const gameRow = scenesItems.filter(s => GAME_LEVEL_NAMES.includes(s));
            const classicRow = scenesItems.filter(s => s !== 'BACK' && !GAME_LEVEL_NAMES.includes(s));
            const rowsDef = [
                { items: gameRow, game: true, y: 8.8, spacing: 4.6 },
                { items: classicRow, game: false, y: 4.4, spacing: 4.0 },
                { items: ['BACK'], game: false, y: 1.0, spacing: 4.0 }
            ];
            rowsDef.forEach((row, ry) => {
                tvGrid[ry] = [];
                const n = row.items.length;
                row.items.forEach((label, ix) => {
                    const idx = scenesItems.indexOf(label);
                    const w = row.game ? 3.8 : 3.0, hgt = row.game ? 2.5 : 1.9;
                    const tvMat = new THREE.MeshPhongMaterial({
                        color: 0x000000,
                        emissive: row.game ? 0x2a2000 : 0x003300
                    });
                    const tv = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, 0.2), tvMat);
                    tv.position.set((ix - (n - 1) / 2) * row.spacing, row.y, 0);
                    tv.userData = { x: ix, y: ry, index: idx, type: 'tvBox', game: row.game };
                    scene.add(tv);
                    scenesMenuMeshes.push(tv);
                    tvMeshes.push(tv);
                    tvGrid[ry][ix] = tv;
                    if (font) {
                        const textMesh = makeTextLabel(label, row.game ? 0.32 : 0.28,
                            row.game ? 0xffd700 : 0x00FF00);
                        textMesh.position.set(tv.position.x, tv.position.y - 0.05, 0.12);
                        textMesh.userData = { index: idx, type: 'sceneOption', tv: tv };
                        scene.add(textMesh);
                        scenesMenuMeshes.push(textMesh);
                        tv.userData.textMesh = textMesh;
                        if (row.game) {
                            const tag = makeTextLabel('· TYPE WORDS ·', 0.17, 0xffffff);
                            tag.position.set(tv.position.x, tv.position.y - 0.82, 0.12);
                            scene.add(tag);
                            scenesMenuMeshes.push(tag);
                        }
                    }
                });
            });

            currentTvX = 0;
            currentTvY = 0;
            updateScenesSelection();
        }

        function createOptionsMenu() {
            inOptionsMenu = true;
            menuMeshes.forEach(m => scene.remove(m));
            menuMeshes = [];
            optionsMenuMeshes = [];

            optionsItems.forEach((text, i) => {
                const charGeo = new THREE.TextGeometry(text, {
                    font: font, size: 0.8, height: 0.2
                });
                charGeo.computeBoundingBox();
                const material = new THREE.MeshPhongMaterial({ color: 0xffffff });
                const mesh = new THREE.Mesh(charGeo, material);
                
                const width = charGeo.boundingBox.max.x - charGeo.boundingBox.min.x;
                mesh.position.set(-width / 2, (optionsItems.length / 2 - i) * 2, 0);
                mesh.userData = { index: i };
                scene.add(mesh);
                optionsMenuMeshes.push(mesh);
            });
            updateOptionsSelection();
        }

        function updateOptionsSelection() {
            optionsMenuMeshes.forEach((mesh, i) => {
                const isSelected = i === selectedOptionIndex;
                mesh.material.color.setHex(isSelected ? 0xff0000 : 0xffffff);
                mesh.scale.setScalar(isSelected ? 1.2 : 1.0);
                
                // Show values for sliders
                if (optionsItems[i] === 'SOUND VOLUME') {
                    mesh.name = `SOUND VOLUME: ${Math.round(soundVolume * 100)}%`;
                } else if (optionsItems[i] === 'GRAVITY') {
                    mesh.name = `GRAVITY: ${worldGravity.toFixed(2)}`;
                } else if (optionsItems[i] === 'MAX LETTERS') {
                    mesh.name = `MAX LETTERS: ${maxLetters}`;
                } else {
                    mesh.name = optionsItems[i];
                }
            });
        }

        function updateScenesSelection() {
            const selectedTv = tvGrid[currentTvY][currentTvX];
            selectedSceneIndex = selectedTv.userData.index;

            tvMeshes.forEach(tv => {
                const isSelected = tv === selectedTv;
                const g = tv.userData.game;
                tv.material.emissive.setHex(isSelected
                    ? (g ? 0x6a5200 : 0x006600)
                    : (g ? 0x2a2000 : 0x003300));
                if (tv.userData.textMesh) {
                    tv.userData.textMesh.material.color.setHex(isSelected ? 0xffffff : (g ? 0xffd700 : 0x00ff00));
                    tv.userData.textMesh.scale.setScalar(isSelected ? 1.35 : 1.0);
                }
            });

            // Partial-zoom camera: drift toward the selected shelf but keep
            // the whole wall in view.
            targetCameraPos.set(selectedTv.position.x * 0.55, selectedTv.position.y * 0.55 + 2.4, 13.5);
            targetCameraLookAt.set(selectedTv.position.x * 0.7, selectedTv.position.y * 0.85, 0);
        }

        function createMenu() {
            menuMeshes.forEach(m => scene.remove(m));
            menuMeshes = [];
            targetCameraPos.set(0, 5, 15);
            targetCameraLookAt.set(0, 0, 0);

            menuItems.forEach((text, i) => {
                const group = new THREE.Group();
                let xOffset = 0;
                for (let j = 0; j < text.length; j++) {
                    const charGeo = new THREE.TextGeometry(text[j], {
                        font: font, size: 0.8, height: 0.2, curveSegments: 12
                    });
                    charGeo.computeBoundingBox();
                    const charMesh = new THREE.Mesh(charGeo, new THREE.MeshPhongMaterial({ color: 0xffffff }));
                    charMesh.position.x = xOffset;
                    xOffset += charGeo.boundingBox.max.x - charGeo.boundingBox.min.x + 0.1;
                    group.add(charMesh);
                }

                const box = new THREE.Box3().setFromObject(group);
                const width = box.max.x - box.min.x;
                group.children.forEach(c => c.position.x -= width / 2);
                
                group.position.y = (menuItems.length / 2 - i) * 2;
                group.userData = { index: i, baseScale: 1, targetScale: 1, originalY: group.position.y };
                scene.add(group);
                menuMeshes.push(group);
            });
            updateSelection();
        }

        function updateSelection() {
            menuMeshes.forEach((mesh, i) => {
                mesh.userData.targetScale = (i === selectedIndex) ? 1.5 : 1.0;
                mesh.children.forEach(char => {
                    char.material.color.setHex(i === selectedIndex ? 0xff0000 : 0xffffff);
                });
            });
        }

        // ==== MENU STATE MACHINE ==============================================
        // Single authority for which screen is visible. Tears down EVERY menu
        // screen's meshes first, so it is impossible to be in two screens at once
        // (fixes "SCENES and OPTIONS open on top of each other"). Then it builds the
        // requested screen and syncs the legacy booleans the rest of the code reads.
        function clearAllMenuMeshes() {
            menuMeshes.forEach(m => scene.remove(m)); menuMeshes = [];
            scenesMenuMeshes.forEach(m => scene.remove(m)); scenesMenuMeshes = [];
            tvMeshes = []; tvGrid = [];
            optionsMenuMeshes.forEach(m => scene.remove(m)); optionsMenuMeshes = [];
            escapeMenuMeshes.forEach(m => scene.remove(m)); escapeMenuMeshes = [];
            showEscapeMenu = false;
        }

        function setMenuScreen(name) {
            if (!MENU_SCREENS.includes(name)) name = 'MAIN';
            // Exclusivity: remove all menu meshes and reset the derived flags before
            // building the target screen. Only ONE screen is ever live afterwards.
            clearAllMenuMeshes();
            inScenesMenu = false;
            inOptionsMenu = false;
            menuScreen = name;

            // Hide the current scene's geometry behind any menu so the menu (which sits
            // at the world origin) isn't buried inside scene meshes — e.g. the SPACE moon
            // surface. The objects stay in the scene so PLAYING resumes them instantly.
            const inMenu = (name !== 'PLAYING');
            sceneObjects.forEach(o => { if (o) o.visible = !inMenu; });

            // Word-quest HUDs: only visible while actually playing.
            setWordHudVisible(name === 'PLAYING');
            setObjectiveVisible(name === 'PLAYING' && !!gameMode);
            if (name !== 'PLAYING') hideBanner();

            if (name === 'MAIN') {
                gameStarted = false;
                clearBowl();               // no bowl behind the title menu
                createMenu();
            } else if (name === 'SCENES') {
                gameStarted = false;
                clearBowl();
                createScenesMenu();        // sets inScenesMenu = true
            } else if (name === 'OPTIONS') {
                gameStarted = false;
                clearBowl();
                selectedOptionIndex = 0;
                createOptionsMenu();       // sets inOptionsMenu = true
            } else if (name === 'PLAYING') {
                gameStarted = true;
                // Resume the toy. If no real scene is loaded yet, start the default one
                // (clean-slate so we never stack the desert on top of a previous level).
                if (currentScene === 'default' || !currentScene) {
                    buildScene(createDesertScene);
                }
                setupPlayArea();
            }
        }

        // Activate a highlighted MAIN-menu item. START GAME force-restarts the default
        // scene; SCENES/OPTIONS switch screens; EXIT closes the whole menu and returns
        // to PLAYING (resume the toy) — never a dead button.
        function activateMainMenuItem(item) {
            if (item === 'START GAME') {
                currentScene = 'default';      // force a fresh default scene
                setMenuScreen('PLAYING');
            } else if (item === 'SCENES') {
                setMenuScreen('SCENES');
            } else if (item === 'OPTIONS') {
                setMenuScreen('OPTIONS');
            } else if (item === 'EXIT') {
                setMenuScreen('PLAYING');      // resume the toy (or start default)
            }
        }

        function selectCurrentScene() {
            const selected = scenesItems[selectedSceneIndex];
            console.log(`Selecting scene: ${selected} at index ${selectedSceneIndex}`);
            if (selected === 'BACK' || !selected) {
                setMenuScreen('MAIN');
                return;
            }
            // LLF-67: scenes register themselves in window.SCENES (src/scenes/registry.js);
            // the old hard-coded builders map is gone.
            const entry = SCENES[selected];
            const build = entry && entry.build;
            if (build) buildScene(build);     // clean-slate wipe + build the chosen scene
            // Enter PLAYING. currentScene is now a real scene, so setMenuScreen won't
            // re-create the default; it just tears down the scenes menu + builds the
            // play area/bowl.
            setMenuScreen('PLAYING');
        }


        // The old ad-hoc in-game "escape overlay" menu has been replaced by the
        // setMenuScreen() state machine (Esc now toggles PLAYING <-> MAIN). This array is
        // retained only so clearAllMenuMeshes()/animate never reference an undefined and
        // any stray overlay meshes can still be torn down.
        let escapeMenuMeshes = [];

        function onKeyDown(e) {
            // In any menu screen, claim the navigation keys so the browser doesn't
            // scroll the page or move focus — that hijacking made arrow-key menu
            // navigation appear "dead" even though the handler below runs fine.
            if (menuScreen !== 'PLAYING' &&
                ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(e.key)) {
                e.preventDefault();
            }
            // Esc toggles the menu open/closed via the state machine: from PLAYING it
            // opens the MAIN menu (pauses), from any menu screen it resumes the toy.
            try { if (rideKey(e)) return; } catch (err) { console.error('rideKey', err); } // LLF-10
            if (e.key === 'Escape') {
                setMenuScreen(menuScreen === 'PLAYING' ? 'MAIN' : 'PLAYING');
                return;
            }

            if (menuScreen === 'MAIN') {
                if (e.key === 'ArrowUp') {
                    selectedIndex = (selectedIndex - 1 + menuItems.length) % menuItems.length;
                    updateSelection();
                } else if (e.key === 'ArrowDown') {
                    selectedIndex = (selectedIndex + 1) % menuItems.length;
                    updateSelection();
                } else if (e.key === 'Enter') {
                    activateMainMenuItem(menuItems[selectedIndex]);
                }
            } else if (menuScreen === 'OPTIONS') {
                if (e.key === 'ArrowUp') {
                    selectedOptionIndex = (selectedOptionIndex - 1 + optionsItems.length) % optionsItems.length;
                    updateOptionsSelection();
                } else if (e.key === 'ArrowDown') {
                    selectedOptionIndex = (selectedOptionIndex + 1) % optionsItems.length;
                    updateOptionsSelection();
                } else if (e.key === 'ArrowLeft') {
                    if (optionsItems[selectedOptionIndex] === 'SOUND VOLUME') {
                        soundVolume = Math.max(0, soundVolume - 0.1);
                        updateOptionsSelection();
                    } else if (optionsItems[selectedOptionIndex] === 'GRAVITY') {
                        worldGravity = Math.min(0, worldGravity + 1);
                        world.gravity.set(0, worldGravity, 0);
                        updateOptionsSelection();
                    } else if (optionsItems[selectedOptionIndex] === 'MAX LETTERS') {
                        maxLetters = Math.max(1, maxLetters - 5);
                        updateOptionsSelection();
                    }
                } else if (e.key === 'ArrowRight') {
                    if (optionsItems[selectedOptionIndex] === 'SOUND VOLUME') {
                        soundVolume = Math.min(1, soundVolume + 0.1);
                        updateOptionsSelection();
                    } else if (optionsItems[selectedOptionIndex] === 'GRAVITY') {
                        worldGravity = Math.max(-20, worldGravity - 1);
                        world.gravity.set(0, worldGravity, 0);
                        updateOptionsSelection();
                    } else if (optionsItems[selectedOptionIndex] === 'MAX LETTERS') {
                        maxLetters = Math.min(200, maxLetters + 5);
                        updateOptionsSelection();
                    }
                } else if (e.key === 'Enter') {
                    if (optionsItems[selectedOptionIndex] === 'BACK') {
                        setMenuScreen('MAIN');
                    }
                }
            } else if (menuScreen === 'SCENES') {
                // Jagged shelves: clamp x to the row we land on.
                if (e.key === 'ArrowUp') {
                    currentTvY = Math.max(0, currentTvY - 1);
                    currentTvX = Math.min(currentTvX, tvGrid[currentTvY].length - 1);
                    updateScenesSelection();
                } else if (e.key === 'ArrowDown') {
                    currentTvY = Math.min(tvGrid.length - 1, currentTvY + 1);
                    currentTvX = Math.min(currentTvX, tvGrid[currentTvY].length - 1);
                    updateScenesSelection();
                } else if (e.key === 'ArrowLeft') {
                    currentTvX = Math.max(currentTvX - 1, 0);
                    updateScenesSelection();
                } else if (e.key === 'ArrowRight') {
                    currentTvX = Math.min(currentTvX + 1, tvGrid[currentTvY].length - 1);
                    updateScenesSelection();
                } else if (e.key === 'Enter') {
                    selectCurrentScene();
                }
            } else {
                if (e.key.length === 1) {
                    const now = Date.now();
                    lastTypeTime = now;

                    // Word-quest levels consume typing entirely: keys feed the
                    // input buffer + word matcher instead of spawning letters.
                    if (gameMode) {
                        handleGameKey(e.key);
                        return;
                    }

                    if (/[a-zA-Z0-9]/.test(e.key)) {
                        const char = e.key.toUpperCase();
                        const letterObj = spawnLetter(char);
                        if (letterObj && letterObj.mesh) {
                            playTone(char, letterObj.mesh.position);
                        }

                        // LLF-2: Combo-Based Firework Triggers — fast typing sets off fireworks
                        comboKeyTimes.push(now);
                        if (comboKeyTimes.length > COMBO_SPEED_COUNT) comboKeyTimes.shift();
                        if (comboKeyTimes.length >= COMBO_SPEED_COUNT &&
                            (now - comboKeyTimes[0]) <= COMBO_SPEED_MS &&
                            (now - lastComboTime) > COMBO_COOLDOWN_MS) {
                            lastComboTime = now;
                            comboKeyTimes = [];
                            triggerComboFireworks(1);
                        }

                        // LLF-12: Alphabetical Rain — repeating one letter fast rains it down
                        if (char === rainLastChar && (now - rainLastTime) < RAIN_WINDOW_MS) {
                            rainRepeat++;
                        } else {
                            rainRepeat = 1;
                        }
                        rainLastChar = char; rainLastTime = now;
                        if (rainRepeat >= RAIN_TRIGGER_COUNT && !rainActive) {
                            rainRepeat = 0;
                            startLetterRain(char);
                        }

                        inputBuffer += char;
                        if (inputBuffer.length > 16) {
                            inputBuffer = inputBuffer.slice(-16);
                        }
                        bumpHeat();
                        updateWordHud();
                        try { rideCheckBuffer(inputBuffer); } catch (err) { console.error('ride', err); } // LLF-10

                        // LLF-35: Prioritize longer words over shorter words
                        // Check for words in the buffer
                        let foundWords = [];
                        for (const word of DICTIONARY) {
                            if (inputBuffer.endsWith(word)) {
                                foundWords.push(word);
                            }
                        }

                        if (foundWords.length > 0) {
                            // Sort by length descending
                            foundWords.sort((a, b) => b.length - a.length);
                            const longestWord = foundWords[0];
                            console.log(longestWord);
                            // LLF-36: Special handling for "FEATUREBOARD"
                            if (longestWord === "FEATUREBOARD") {
                                hudFlashSuccess(longestWord);
                                yellWord("FEATUREBOARD");
                                launchNuke();
                                inputBuffer = "";
                                typedWord = "";
                                if (wordPending) {
                                    clearTimeout(wordPending.timer);
                                    wordPending = null;
                                }
                                return;
                            }

                            // LLF-15: Special handling for Zoo Animals
                            const zooAnimals = ['LION', 'ELEPHANT', 'MONKEY', 'ZEBRA', 'GIRAFFE'];
                            if (zooAnimals.includes(longestWord)) {
                                hudFlashSuccess(longestWord);
                                spawnZooAnimal(longestWord);
                                inputBuffer = "";
                                typedWord = "";
                                if (wordPending) {
                                    clearTimeout(wordPending.timer);
                                    wordPending = null;
                                }
                                return;
                            }

                            // If we have a pending word timer, and this word is longer, clear the old timer
                            if (wordPending && longestWord.length > wordPending.word.length) {
                                clearTimeout(wordPending.timer);
                                wordPending = null;
                            }

                            // If nothing is pending, or this is the longest word we've seen
                            if (!wordPending) {
                                // Wait 5 seconds before committing the word, to allow for longer words
                                const timer = setTimeout(() => {
                                    hudFlashSuccess(longestWord);
                                    spellWordInScene(longestWord);
                                    inputBuffer = ""; // Clear buffer after finding a word
                                    typedWord = "";
                                    wordPending = null;
                                }, 2000);
                                wordPending = { word: longestWord, timer: timer };
                            }
                        }

                        typedWord += char;
                        // Check for common words or just length (e.g. 5+ chars for a gravity well)
                        if (typedWord.length >= 10) {
                            createGravityWell(typedWord, new THREE.Vector3(0, 0, 0));
                            typedWord = ""; // Reset after creating well
                        }
                    } else if (e.key === ' ') {
                        if (typedWord.length > 0) {
                            //createGravityWell(typedWord, new THREE.Vector3(0, 0, 0));
                            typedWord = "";
                        }
                        inputBuffer = ""; // Clear buffer on space
                        updateWordHud();

                        // LLF-16: Spacebar acts as time-slow trigger
                        isTimeSlowed = !isTimeSlowed;
                        timeScale = isTimeSlowed ? 0.2 : 1.0;
                        console.log(`Time Dilation: ${isTimeSlowed ? 'SLOWED' : 'NORMAL'}`);
                    } else {
                        spawnShape();
                    }
                }
            }
        }

        function onMouseMove(event) {
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
            
            // LLF-58: Camera mouse exploration offset
            // Move camera slightly when mouse is near edges
            cameraMouseOffset.x = mouse.x * 2.0;
            cameraMouseOffset.y = mouse.y * 1.5;
            
            if (isRightClickHolding && gameStarted) {
                raycaster.setFromCamera(mouse, camera);
                const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
                const point = new THREE.Vector3();
                raycaster.ray.intersectPlane(plane, point);
                
                fusePath.push(point.clone());
                
                const dotGeo = new THREE.SphereGeometry(0.05, 4, 4);
                const dotMat = new THREE.MeshBasicMaterial({ color: 0xaa5500 });
                const dot = new THREE.Mesh(dotGeo, dotMat);
                dot.position.copy(point);
                scene.add(dot);
                fuseDots.push(dot);
            }

            if (isDrawing && gameStarted) {
                raycaster.setFromCamera(mouse, camera);
                // Create a virtual plane at z=0 to draw on
                const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
                const point = new THREE.Vector3();
                raycaster.ray.intersectPlane(plane, point);
                
                paintbrushPath.push(point.clone());
                
                // Visual feedback for the trail
                const dotGeo = new THREE.SphereGeometry(0.1, 8, 8);
                const dotMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
                const dot = new THREE.Mesh(dotGeo, dotMat);
                dot.position.copy(point);
                scene.add(dot);
                trailParticles.push(dot);
            }

            if (!gameStarted && !inScenesMenu && !inOptionsMenu) {
                raycaster.setFromCamera(mouse, camera);
                const intersects = raycaster.intersectObjects(menuMeshes, true);
                if (intersects.length > 0) {
                    let obj = intersects[0].object;
                    while (obj.parent && !menuMeshes.includes(obj)) obj = obj.parent;
                    if (menuMeshes.includes(obj)) {
                        const newIndex = obj.userData.index;
                        if (newIndex !== selectedIndex) {
                            selectedIndex = newIndex;
                            updateSelection();
                        }
                    }
                }
            } else if (inOptionsMenu) {
                raycaster.setFromCamera(mouse, camera);
                const intersects = raycaster.intersectObjects(optionsMenuMeshes);
                if (intersects.length > 0) {
                    const idx = intersects[0].object.userData.index;
                    if (idx !== selectedOptionIndex) {
                        selectedOptionIndex = idx;
                        updateOptionsSelection();
                    }
                }
            } else if (inScenesMenu) {
                raycaster.setFromCamera(mouse, camera);
                const intersects = raycaster.intersectObjects(tvMeshes);
                if (intersects.length > 0) {
                    const tv = intersects[0].object;
                    if (tv.userData.x !== currentTvX || tv.userData.y !== currentTvY) {
                        currentTvX = tv.userData.x;
                        currentTvY = tv.userData.y;
                        updateScenesSelection();
                    }
                }
            }
        }

        function onMouseDown(e) {
            try { rideMouseDown(e); } catch (err) { console.error('rideMouseDown', err); } // LLF-10
            if (menuScreen === 'PLAYING') {
                if (e.button === 0 && handleSpigotClick()) return; // click a valve to toggle its flow
                if (e.button === 2) { // Right click
                    isRightClickHolding = true;
                    rightClickStartTime = Date.now();
                    fusePath = [];
                    fuseDots.forEach(d => scene.remove(d));
                    fuseDots = [];

                    raycaster.setFromCamera(mouse, camera);
                    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
                    const point = new THREE.Vector3();
                    raycaster.ray.intersectPlane(plane, point);
                    
                    // Put the rocket down
                    const rocketGeo = new THREE.CylinderGeometry(0.2, 0.2, 1, 8);
                    // LLF-47: Metallic rocket material
                    const rocketMat = new THREE.MeshStandardMaterial({ 
                        color: 0xff0000,
                        metalness: 0.7,
                        roughness: 0.4,
                        envMapIntensity: 0.8,
                        flatShading: true
                    });
                    rocketMesh = new THREE.Mesh(rocketGeo, rocketMat);
                    rocketMesh.position.copy(point);
                    scene.add(rocketMesh);
                    
                    const rocketShape = new CANNON.Cylinder(0.2, 0.2, 1, 8);
                    rocketBody = new CANNON.Body({ mass: 1 });
                    rocketBody.addShape(rocketShape);
                    rocketBody.position.set(point.x, point.y, point.z);
                    world.addBody(rocketBody);
                    physicsBodies.push({ mesh: rocketMesh, body: rocketBody, type: 'rocket' });
                    
                    fusePath.push(point.clone());
                    return;
                }

                if (e.button === 1) { // Middle click
                    raycaster.setFromCamera(mouse, camera);
                    const intersects = raycaster.intersectObjects(physicsBodies.map(pb => pb.mesh));
                    if (intersects.length > 0) {
                        const hit = physicsBodies.find(pb => pb.mesh === intersects[0].object);
                        if (hit) {
                            explodeLetter(hit);
                        }
                    }
                    return;
                }

                isDrawing = true;
                paintbrushPath = [];
                trailParticles.forEach(p => scene.remove(p));
                trailParticles = [];

                raycaster.setFromCamera(mouse, camera);
                const intersects = raycaster.intersectObjects(physicsBodies.map(pb => pb.mesh));
                if (intersects.length > 0) {
                    const hit = physicsBodies.find(pb => pb.mesh === intersects[0].object);
                    if (hit) {
                        if (hit.type === 'zoo_animal') {
                            playZooAnimalSound(hit.animal);
                            hit.body.applyImpulse(new CANNON.Vec3(0, 15, 0), hit.body.position);
                            hit.body.angularVelocity.set(Math.random() * 10, Math.random() * 10, Math.random() * 10);
                        } else {
                            hit.body.applyImpulse(new CANNON.Vec3(0, 10, -5), hit.body.position);
                        }
                    }
                }
            } else if (menuScreen === 'OPTIONS') {
                // Single click acts on whatever item was clicked (no select-then-click).
                raycaster.setFromCamera(mouse, camera);
                const intersects = raycaster.intersectObjects(optionsMenuMeshes);
                if (intersects.length > 0) {
                    selectedOptionIndex = intersects[0].object.userData.index;
                    updateOptionsSelection();
                    const item = optionsItems[selectedOptionIndex];
                    if (item === 'BACK') {
                        setMenuScreen('MAIN');
                    } else if (item === 'SOUND VOLUME') {
                        soundVolume = (soundVolume + 0.2);
                        if (soundVolume > 1.1) soundVolume = 0;
                        updateOptionsSelection();
                    } else if (item === 'GRAVITY') {
                        worldGravity -= 2;
                        if (worldGravity < -20) worldGravity = 0;
                        world.gravity.set(0, worldGravity, 0);
                        updateOptionsSelection();
                    } else if (item === 'MAX LETTERS') {
                        maxLetters += 10;
                        if (maxLetters > 100) maxLetters = 10;
                        updateOptionsSelection();
                    }
                }
            } else if (menuScreen === 'SCENES') {
                // Single click selects that TV and loads the scene immediately.
                raycaster.setFromCamera(mouse, camera);
                const intersects = raycaster.intersectObjects(tvMeshes);
                if (intersects.length > 0) {
                    const tv = intersects[0].object;
                    currentTvX = tv.userData.x;
                    currentTvY = tv.userData.y;
                    updateScenesSelection();
                    selectCurrentScene();
                }
            } else {
                // MAIN Menu Click — a single click on an item activates it immediately
                // (all four items are wired, including OPTIONS and EXIT).
                raycaster.setFromCamera(mouse, camera);
                const intersects = raycaster.intersectObjects(menuMeshes, true);
                if (intersects.length > 0) {
                    let obj = intersects[0].object;
                    while (obj.parent && !menuMeshes.includes(obj)) obj = obj.parent;
                    if (menuMeshes.includes(obj)) {
                        selectedIndex = obj.userData.index;
                        updateSelection();
                        activateMainMenuItem(menuItems[selectedIndex]);
                    }
                }
            }
        }

        function onMouseUp(e) {
            try { rideMouseUp(e); } catch (err) { console.error('rideMouseUp', err); } // LLF-10
            if (isRightClickHolding) {
                isRightClickHolding = false;
                const rocket = { mesh: rocketMesh, body: rocketBody, fuse: [...fusePath], dots: [...fuseDots] };
                scene.userData.pendingRockets = scene.userData.pendingRockets || [];
                scene.userData.pendingRockets.push(rocket);
                fuseDots = [];
                fusePath = [];
                rocketMesh = null;
                rocketBody = null;
            }

            if (isDrawing) {
                isDrawing = false;
                // Ignite the trail!
                paintbrushPath.forEach(pos => {
                    spawnFirework(pos);
                });
                
                // Remove visual trail dots
                trailParticles.forEach(p => scene.remove(p));
                trailParticles = [];
                paintbrushPath = [];
            }
        }
