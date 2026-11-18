#include "unity.h"
#include "prsl_ws_track.h"

void setUp(void) {}
void tearDown(void) {}

void test_track_add_snapshot(void) {
    uint32_t ids[PRSL_WS_TRACK_MAX];
    prsl_ws_track_reset();
    TEST_ASSERT_TRUE(prsl_ws_track_add(1));
    TEST_ASSERT_TRUE(prsl_ws_track_add(2));
    TEST_ASSERT_TRUE(prsl_ws_track_add(3));
    TEST_ASSERT_EQUAL(3, prsl_ws_track_snapshot(ids, PRSL_WS_TRACK_MAX));
    TEST_ASSERT_EQUAL_UINT32(1, ids[0]);
    TEST_ASSERT_EQUAL_UINT32(2, ids[1]);
    TEST_ASSERT_EQUAL_UINT32(3, ids[2]);

    prsl_ws_track_remove(2);
    TEST_ASSERT_EQUAL(2, prsl_ws_track_snapshot(ids, PRSL_WS_TRACK_MAX));
    TEST_ASSERT_EQUAL_UINT32(1, ids[0]);
    TEST_ASSERT_EQUAL_UINT32(3, ids[1]);
}

void test_track_duplicate(void) {
    uint32_t ids[PRSL_WS_TRACK_MAX];
    prsl_ws_track_reset();
    TEST_ASSERT_TRUE(prsl_ws_track_add(7));
    TEST_ASSERT_TRUE(prsl_ws_track_add(7));
    TEST_ASSERT_EQUAL(1, prsl_ws_track_snapshot(ids, PRSL_WS_TRACK_MAX));
    TEST_ASSERT_EQUAL_UINT32(7, ids[0]);
}

void test_track_capacity(void) {
    uint32_t ids[PRSL_WS_TRACK_MAX];
    prsl_ws_track_reset();
    for (uint32_t i = 0; i < PRSL_WS_TRACK_MAX; i++) {
        TEST_ASSERT_TRUE(prsl_ws_track_add(i + 1));
    }
    TEST_ASSERT_FALSE(prsl_ws_track_add(999));
    TEST_ASSERT_EQUAL(PRSL_WS_TRACK_MAX,
                      prsl_ws_track_snapshot(ids, PRSL_WS_TRACK_MAX));

    prsl_ws_track_remove(1);
    TEST_ASSERT_TRUE(prsl_ws_track_add(999));
    TEST_ASSERT_EQUAL(PRSL_WS_TRACK_MAX,
                      prsl_ws_track_snapshot(ids, PRSL_WS_TRACK_MAX));
}

void test_track_snapshot_cap(void) {
    uint32_t one[1];
    prsl_ws_track_reset();
    TEST_ASSERT_TRUE(prsl_ws_track_add(1));
    TEST_ASSERT_TRUE(prsl_ws_track_add(2));
    TEST_ASSERT_TRUE(prsl_ws_track_add(3));
    TEST_ASSERT_EQUAL(1, prsl_ws_track_snapshot(one, 1));
    TEST_ASSERT_EQUAL_UINT32(1, one[0]);
}

void test_track_remove_missing(void) {
    uint32_t ids[PRSL_WS_TRACK_MAX];
    prsl_ws_track_reset();
    TEST_ASSERT_TRUE(prsl_ws_track_add(5));
    prsl_ws_track_remove(6);
    TEST_ASSERT_EQUAL(1, prsl_ws_track_snapshot(ids, PRSL_WS_TRACK_MAX));
    TEST_ASSERT_EQUAL_UINT32(5, ids[0]);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_track_add_snapshot);
    RUN_TEST(test_track_duplicate);
    RUN_TEST(test_track_capacity);
    RUN_TEST(test_track_snapshot_cap);
    RUN_TEST(test_track_remove_missing);
    return UNITY_END();
}
