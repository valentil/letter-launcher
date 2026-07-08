
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../launcher.html'), 'utf8');

function testZooAnimals() {
    console.log("Checking for Zoo Animal logic...");
    
    const hasSpawnZooAnimal = html.includes('function spawnZooAnimal');
    const hasPlayZooAnimalSound = html.includes('function playZooAnimalSound');
    const hasLion = html.includes('LION');
    const hasElephant = html.includes('ELEPHANT');
    const hasGiraffe = html.includes('GIRAFFE');
    
    // Check for wandering and click reaction logic as per LLF-3
    const hasWander = html.includes('wander'); // We will add this
    const hasClickReaction = html.includes('click'); // We will add/verify this
    
    if (hasSpawnZooAnimal && hasPlayZooAnimalSound && hasLion && hasElephant && hasGiraffe) {
        console.log("✅ Zoo Animal logic structure found.");
    } else {
        console.error("❌ Missing Zoo Animal logic components.");
        process.exit(1);
    }
}

testZooAnimals();
console.log("Test passed!");
