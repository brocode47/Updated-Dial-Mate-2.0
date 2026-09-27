const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    let success = true;

    // Test 1: PrismaClient should expose whatsAppIntegration model
    if (!prisma.whatsAppIntegration) {
        console.error("FAIL: whatsAppIntegration is not defined on PrismaClient");
        success = false;
    } else {
        console.log("PASS: whatsAppIntegration is defined");
        if (typeof prisma.whatsAppIntegration.create !== 'function') {
            console.error("FAIL: create is not a function");
            success = false;
        }
    }

    // Test 2: Shop model should exist
    if (!prisma.shop) {
        console.error("FAIL: shop is not defined on PrismaClient");
        success = false;
    } else {
        console.log("PASS: shop is defined");
    }

    // Test 3: DB connection will fail, proving structural only
    try {
        await prisma.$connect();
        console.log("FAIL: DB connected unexpectedly.");
        success = false;
    } catch (err) {
        if (/ECONNREFUSED|connect|Authentication/i.test(err.message)) {
            console.log("PASS: DB connection failed as expected (runtime not available)");
        } else {
            console.error("FAIL: Unexpected error", err.message);
            success = false;
        }
    }

    if (success) {
        console.log("ALL TESTS PASSED.");
    } else {
        console.log("SOME TESTS FAILED.");
    }
}
run();
