/**
 * Mirror of Android's RLFulllVideoModelBodyClass
 * Maps 1:1 to Firebase JSON fields.
 */
export interface VideoModel {
  assumedREV: string;
  assumedRMS: string;
  classType: string;
  cumulativeRiders: string;
  currentVideoGroup: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced' | string;
  duration: string;
  imageLinkInstructor: string;
  imageLinkLarge: string;
  imageLinkSmall: string;
  imageLinkSquareV2: string;
  imageLinkfeedV2: string;
  imageLinkrectangleV2: string;
  instructor: string;
  instructorClasses: string;
  keywords: string;
  mincooldown: string;
  mininstruction: string;
  minwarmup: string;
  originalClassDate: string;
  rating: string;
  rideDescription: string;
  rideTitle: string;
  streamingUrl: string;
  streamingUrlIpad: string;
  streamingUrlIphonex: string;
  style: string;
  timestamp: string;
  type: string;
  videoLinkiPad: string;
  videoLinkiPhone: string;
  videoLinkiPhonex: string;
}
