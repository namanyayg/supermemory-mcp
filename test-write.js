// Test script for /write endpoint
// Usage: node test-write.js

// const BASE_URL = 'http://localhost:5174';
const BASE_URL = 'https://supermemory-mcp-app.mail-b83.workers.dev';

/**
 * @param {string} testName
 * @param {object} data
 */
async function testWrite(testName, data) {
    console.log(`\n🧪 Testing: ${testName}`);
    console.log(`📤 Sending:`, JSON.stringify(data, null, 2));
    
    try {
        const response = await fetch(`${BASE_URL}/write`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();
        
        console.log(`📊 Status: ${response.status}`);
        console.log(`📥 Response:`, JSON.stringify(result, null, 2));
        
        if (response.ok) {
            console.log('✅ Test passed');
        } else {
            console.log('❌ Test failed');
        }
        
        return { success: response.ok, result };
        
    } catch (error) {
        console.log('💥 Network error:', error instanceof Error ? error.message : String(error));
        console.log('❌ Test failed');
        return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
}

async function runTests() {
    console.log('🚀 Starting /write endpoint tests...');
    console.log(`🎯 Target URL: ${BASE_URL}/write`);
    
    // Test 1: Valid request with body only
    await testWrite('Basic write with body only', {
        body: 'This is a test memory entry for the basic functionality test'
    });
    
    // Test 2: Longer request
    await testWrite('Write with body and integer tokenLength', {
        body: 'This is a more complex test entry that includes token length information.',
    });

    console.log('\n🎉 Test cycle completed!');
}

async function runContinuousTests() {
    console.log('🔄 Starting continuous testing (every 3 seconds)...');
    console.log('💡 Press Ctrl+C to stop the tests\n');
    
    let cycleCount = 0;
    
    while (true) {
        cycleCount++;
        console.log(`\n═══════════════════════════════════════════`);
        console.log(`🔄 Test Cycle #${cycleCount} - ${new Date().toLocaleTimeString()}`);
        console.log(`═══════════════════════════════════════════`);
        
        await runTests();
        
        console.log('\n⏳ Waiting 3 seconds before next cycle...');
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
}

// Run the continuous tests
runContinuousTests().catch(error => {
    console.error('💥 Test runner failed:', error);
    process.exit(1);
}); 