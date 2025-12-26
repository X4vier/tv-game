import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import type { IceCandidateSignal, SdpSignal } from "~/snake/types";
import { db } from "~/server/db";

// Zod schemas for WebRTC signaling
const sdpSignalSchema = z.object({
  type: z.enum(["offer", "answer"]),
  sdp: z.string(),
});

const iceCandidateSchema = z.object({
  candidate: z.object({
    candidate: z.string(),
    sdpMLineIndex: z.number().nullable(),
    sdpMid: z.string().nullable(),
  }),
});

// Clean up old sessions (older than 5 minutes)
async function cleanupOldSessions() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  await db.signalingSession.deleteMany({
    where: {
      updatedAt: {
        lt: fiveMinutesAgo,
      },
    },
  });
}

export const signalingRouter = createTRPCRouter({
  // ============ TV ENDPOINTS ============

  // TV creates a new session and registers its offer
  createSession: publicProcedure
    .input(z.object({ offer: sdpSignalSchema }))
    .mutation(async ({ input }) => {
      // Clean up old sessions first
      await cleanupOldSessions();

      // Create new session with the TV's offer
      const session = await db.signalingSession.create({
        data: {
          tvOffer: input.offer,
        },
      });

      return { sessionId: session.id };
    }),

  // TV adds an ICE candidate
  addTvIceCandidate: publicProcedure
    .input(z.object({ sessionId: z.string(), candidate: iceCandidateSchema }))
    .mutation(async ({ input }) => {
      await db.iceCandidate.create({
        data: {
          sessionId: input.sessionId,
          candidate: input.candidate,
        },
      });
      return { success: true };
    }),

  // TV polls for phone connections (answers)
  getPhoneConnections: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const connections = await db.phoneConnection.findMany({
        where: { sessionId: input.sessionId },
        include: {
          iceCandidates: {
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      return {
        connections: connections.map((conn) => ({
          phoneId: conn.id,
          answer: conn.answer as SdpSignal | null,
          iceCandidates: conn.iceCandidates.map(
            (c) => c.candidate as IceCandidateSignal
          ),
        })),
      };
    }),

  // TV clears its session (on disconnect/reinitialize)
  clearSession: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      await db.signalingSession.delete({
        where: { id: input.sessionId },
      }).catch(() => {
        // Session might already be deleted, ignore
      });
      return { success: true };
    }),

  // ============ PHONE ENDPOINTS ============

  // Phone gets available sessions (for now just get the most recent one)
  getAvailableSession: publicProcedure.query(async () => {
    // Clean up old sessions
    await cleanupOldSessions();

    // Get the most recent session (sessions are only created with offers)
    const session = await db.signalingSession.findFirst({
      orderBy: { createdAt: "desc" },
    });

    if (!session?.tvOffer) {
      return { session: null };
    }

    // Get TV's ICE candidates separately
    const tvCandidates = await db.iceCandidate.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "asc" },
    });

    return {
      session: {
        sessionId: session.id,
        offer: session.tvOffer as SdpSignal,
        tvIceCandidates: tvCandidates.map(
          (c) => c.candidate as IceCandidateSignal
        ),
      },
    };
  }),

  // Phone joins a session and sends its answer
  joinSession: publicProcedure
    .input(z.object({ sessionId: z.string(), answer: sdpSignalSchema }))
    .mutation(async ({ input }) => {
      // Create phone connection with answer
      const connection = await db.phoneConnection.create({
        data: {
          sessionId: input.sessionId,
          answer: input.answer,
        },
      });

      return { phoneId: connection.id };
    }),

  // Phone adds an ICE candidate
  addPhoneIceCandidate: publicProcedure
    .input(z.object({ phoneId: z.string(), candidate: iceCandidateSchema }))
    .mutation(async ({ input }) => {
      await db.iceCandidate.create({
        data: {
          phoneConnectionId: input.phoneId,
          candidate: input.candidate,
        },
      });
      return { success: true };
    }),

  // Phone polls for TV's ICE candidates (after initial fetch)
  getTvIceCandidates: publicProcedure
    .input(z.object({ sessionId: z.string(), afterIndex: z.number().default(0) }))
    .query(async ({ input }) => {
      const candidates = await db.iceCandidate.findMany({
        where: { sessionId: input.sessionId },
        orderBy: { createdAt: "asc" },
        skip: input.afterIndex,
      });

      return {
        candidates: candidates.map((c) => c.candidate as IceCandidateSignal),
        nextIndex: input.afterIndex + candidates.length,
      };
    }),
});
