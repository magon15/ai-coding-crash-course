import { eq, and, sql, inArray } from "drizzle-orm";
import { db } from "~/db";
import { courseRatings, courses } from "~/db/schema";
import { isUserEnrolled } from "~/services/enrollmentService";

// ─── Rating Service ───
// Star ratings (1–5, no written reviews) that enrolled students leave on courses.
// One rating per user per course; rating again replaces the previous value.
// Uses positional parameters (project convention).

export const MIN_RATING = 1;
export const MAX_RATING = 5;

export type RatingSummary = {
  average: number | null;
  count: number;
};

const EMPTY_SUMMARY: RatingSummary = { average: null, count: 0 };

export function isValidRating(rating: number) {
  return (
    Number.isInteger(rating) && rating >= MIN_RATING && rating <= MAX_RATING
  );
}

export function getUserRatingForCourse(userId: number, courseId: number) {
  return db
    .select()
    .from(courseRatings)
    .where(
      and(
        eq(courseRatings.userId, userId),
        eq(courseRatings.courseId, courseId)
      )
    )
    .get();
}

export function canUserRateCourse(userId: number, courseId: number) {
  const course = db
    .select({ instructorId: courses.instructorId })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  if (!course) return false;
  if (course.instructorId === userId) return false;
  return isUserEnrolled(userId, courseId);
}

export function rateCourse(userId: number, courseId: number, rating: number) {
  if (!isValidRating(rating)) {
    throw new Error(
      `Rating must be a whole number between ${MIN_RATING} and ${MAX_RATING}`
    );
  }

  const course = db
    .select({ instructorId: courses.instructorId })
    .from(courses)
    .where(eq(courses.id, courseId))
    .get();
  if (!course) {
    throw new Error("Course not found");
  }
  if (course.instructorId === userId) {
    throw new Error("Instructors cannot rate their own course");
  }
  if (!isUserEnrolled(userId, courseId)) {
    throw new Error("You must be enrolled in this course to rate it");
  }

  const now = new Date().toISOString();
  return db
    .insert(courseRatings)
    .values({ userId, courseId, rating, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [courseRatings.userId, courseRatings.courseId],
      set: { rating, updatedAt: now },
    })
    .returning()
    .get();
}

export function getCourseRatingSummary(courseId: number): RatingSummary {
  return getRatingSummariesForCourses([courseId]).get(courseId) ?? EMPTY_SUMMARY;
}

/**
 * Batch lookup for list pages. Returns a summary for every requested course id,
 * including courses with no ratings (average: null, count: 0).
 */
export function getRatingSummariesForCourses(courseIds: number[]) {
  const summaries = new Map<number, RatingSummary>();
  if (courseIds.length === 0) return summaries;

  for (const id of courseIds) {
    summaries.set(id, EMPTY_SUMMARY);
  }

  const rows = db
    .select({
      courseId: courseRatings.courseId,
      average: sql<number>`avg(${courseRatings.rating})`,
      count: sql<number>`count(*)`,
    })
    .from(courseRatings)
    .where(inArray(courseRatings.courseId, courseIds))
    .groupBy(courseRatings.courseId)
    .all();

  for (const row of rows) {
    summaries.set(row.courseId, {
      average: Math.round(row.average * 10) / 10,
      count: row.count,
    });
  }

  return summaries;
}
