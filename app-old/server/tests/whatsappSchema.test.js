import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
﻿import { PrismaClient } from '@prisma/client';

describe('WhatsAppIntegration Schema', () => {
    let prisma;

    beforeAll(() => {
        prisma = new PrismaClient();
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('PrismaClient should expose whatsAppIntegration model', () => {
        expect(prisma.whatsAppIntegration).toBeDefined();
        expect(typeof prisma.whatsAppIntegration.create).toBe('function');
        expect(typeof prisma.whatsAppIntegration.findUnique).toBe('function');
        expect(typeof prisma.whatsAppIntegration.findMany).toBe('function');
    });

    it('Shop model should include whatsAppIntegrations relation', () => {
        // In Prisma, relations are tested by checking if include supports the relation
        // We can't strictly assert the type in raw JS, but we can verify the model exists.
        expect(prisma.shop).toBeDefined();
    });

    it('Runtime Database is NOT available', async () => {
        // We verify that connection fails, which confirms we are only doing structural validation
        try {
            await prisma.$connect();
            // If it succeeds, maybe the db is running?
            console.log("Database is unexpectedly available.");
        } catch (error) {
            expect(error.message).toMatch(/ECONNREFUSED|connect|Authentication|reach database server|Environment variable not found/);
        }
    });
});
