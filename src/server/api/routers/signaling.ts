import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import type { IceCandidateSignal, SdpSignal } from "~/snake/types";

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

// In-memory storage for signaling data
type SignalingData = {
  tvOffer: SdpSignal | null;
  phoneAnswer: SdpSignal | null;
  tvIceCandidates: IceCandidateSignal[];
  phoneIceCandidates: IceCandidateSignal[];
};

const signalingStore: SignalingData = {
  tvOffer: null,
  phoneAnswer: null,
  tvIceCandidates: [],
  phoneIceCandidates: [],
};

export const signalingRouter = createTRPCRouter({
  // TV registers its SDP offer
  registerTvOffer: publicProcedure
    .input(z.object({ offer: sdpSignalSchema }))
    .mutation(({ input }) => {
      signalingStore.tvOffer = input.offer;
      // Clear previous session data
      signalingStore.phoneAnswer = null;
      signalingStore.tvIceCandidates = [];
      signalingStore.phoneIceCandidates = [];
      return { success: true };
    }),

  // Phone gets TV's offer
  getTvOffer: publicProcedure.query(() => {
    return { offer: signalingStore.tvOffer };
  }),

  // Phone sends its SDP answer
  sendPhoneAnswer: publicProcedure
    .input(z.object({ answer: sdpSignalSchema }))
    .mutation(({ input }) => {
      signalingStore.phoneAnswer = input.answer;
      return { success: true };
    }),

  // TV polls for phone's answer
  getPhoneAnswer: publicProcedure.query(() => {
    return { answer: signalingStore.phoneAnswer };
  }),

  // TV sends ICE candidate
  addTvIceCandidate: publicProcedure
    .input(z.object({ candidate: iceCandidateSchema }))
    .mutation(({ input }) => {
      signalingStore.tvIceCandidates.push(input.candidate);
      return { success: true };
    }),

  // Phone gets TV's ICE candidates
  getTvIceCandidates: publicProcedure.query(() => {
    return { candidates: signalingStore.tvIceCandidates };
  }),

  // Phone sends ICE candidate
  addPhoneIceCandidate: publicProcedure
    .input(z.object({ candidate: iceCandidateSchema }))
    .mutation(({ input }) => {
      signalingStore.phoneIceCandidates.push(input.candidate);
      return { success: true };
    }),

  // TV gets phone's ICE candidates
  getPhoneIceCandidates: publicProcedure.query(() => {
    return { candidates: signalingStore.phoneIceCandidates };
  }),

  // Clear all signaling data (for reset)
  clear: publicProcedure.mutation(() => {
    signalingStore.tvOffer = null;
    signalingStore.phoneAnswer = null;
    signalingStore.tvIceCandidates = [];
    signalingStore.phoneIceCandidates = [];
    return { success: true };
  }),
});
