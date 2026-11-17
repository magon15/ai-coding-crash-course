import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";

let testDb: ReturnType<typeof createTestDb>;
let base: ReturnType<typeof seedBaseData>;

vi.mock("~/db", () => ({
  get db() {
    return testDb;
  },
}));

import {
  rateCourse,
  getUserRatingForCourse,
  canUserRateCourse,
  getCourseRatingSummary,
  getRatingSummariesForCourses,
} from "./ratingService";

function createStudent(email: string) {
  return testDb
    .insert(schema.users)
    .values({ name: email, email, role: schema.UserRole.Student })
    .returning()
    .get();
}

function enroll(userId: number, courseId: number) {
  testDb.insert(schema.enrollments).values({ userId, courseId }).run();
}

describe("ratingService", () => {
  beforeEach(() => {
    testDb = createTestDb();
    base = seedBaseData(testDb);
  });

  describe("rateCourse", () => {
    it("lets an enrolled student rate a course", () => {
      enroll(base.user.id, base.course.id);

      const rating = rateCourse(base.user.id, base.course.id, 4);

      expect(rating.rating).toBe(4);
      expect(getUserRatingForCourse(base.user.id, base.course.id)?.rating).toBe(4);
    });

    it("replaces the existing rating when a student rates again", () => {
      enroll(base.user.id, base.course.id);

      rateCourse(base.user.id, base.course.id, 2);
      rateCourse(base.user.id, base.course.id, 5);

      expect(getUserRatingForCourse(base.user.id, base.course.id)?.rating).toBe(5);
      expect(getCourseRatingSummary(base.course.id).count).toBe(1);
    });

    it.each([0, 6, 3.5, -1, NaN])("rejects invalid rating %s", (value) => {
      enroll(base.user.id, base.course.id);

      expect(() => rateCourse(base.user.id, base.course.id, value)).toThrowError(
        "Rating must be a whole number between 1 and 5"
      );
    });

    it("rejects students who are not enrolled", () => {
      expect(() => rateCourse(base.user.id, base.course.id, 4)).toThrowError(
        "You must be enrolled in this course to rate it"
      );
    });

    it("rejects the course's own instructor", () => {
      enroll(base.instructor.id, base.course.id);

      expect(() =>
        rateCourse(base.instructor.id, base.course.id, 5)
      ).toThrowError("Instructors cannot rate their own course");
    });

    it("rejects a non-existent course", () => {
      expect(() => rateCourse(base.user.id, 9999, 4)).toThrowError(
        "Course not found"
      );
    });
  });

  describe("canUserRateCourse", () => {
    it("is true only for enrolled non-instructors", () => {
      expect(canUserRateCourse(base.user.id, base.course.id)).toBe(false);
      enroll(base.user.id, base.course.id);
      expect(canUserRateCourse(base.user.id, base.course.id)).toBe(true);

      enroll(base.instructor.id, base.course.id);
      expect(canUserRateCourse(base.instructor.id, base.course.id)).toBe(false);
    });
  });

  describe("getCourseRatingSummary", () => {
    it("returns null average and zero count when unrated", () => {
      expect(getCourseRatingSummary(base.course.id)).toEqual({
        average: null,
        count: 0,
      });
    });

    it("averages ratings rounded to one decimal place", () => {
      const ratings = [5, 4, 4];
      ratings.forEach((value, i) => {
        const student = createStudent(`s${i}@example.com`);
        enroll(student.id, base.course.id);
        rateCourse(student.id, base.course.id, value);
      });

      expect(getCourseRatingSummary(base.course.id)).toEqual({
        average: 4.3,
        count: 3,
      });
    });
  });

  describe("getRatingSummariesForCourses", () => {
    it("returns summaries for every requested course, rated or not", () => {
      const other = testDb
        .insert(schema.courses)
        .values({
          title: "Other",
          slug: "other",
          description: "Other course",
          instructorId: base.instructor.id,
          categoryId: base.category.id,
          status: schema.CourseStatus.Published,
        })
        .returning()
        .get();

      enroll(base.user.id, base.course.id);
      rateCourse(base.user.id, base.course.id, 3);

      const summaries = getRatingSummariesForCourses([base.course.id, other.id]);

      expect(summaries.get(base.course.id)).toEqual({ average: 3, count: 1 });
      expect(summaries.get(other.id)).toEqual({ average: null, count: 0 });
    });

    it("returns an empty map for no ids", () => {
      expect(getRatingSummariesForCourses([]).size).toBe(0);
    });
  });
});
