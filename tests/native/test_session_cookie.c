#include "unity.h"
#include "session_cookie.h"

void setUp(void) {}
void tearDown(void) {}

void test_cookie_exact(void) {
    TEST_ASSERT_TRUE(session_cookie_matches("prsl_session=abc", "abc"));
    TEST_ASSERT_TRUE(session_cookie_matches("foo=1; prsl_session=abc; bar=2", "abc"));
    TEST_ASSERT_TRUE(session_cookie_matches("foo=1;prsl_session=abc", "abc"));
    TEST_ASSERT_TRUE(session_cookie_matches("foo=1;  prsl_session=abc", "abc"));
}

void test_cookie_prefix_and_suffix(void) {
    TEST_ASSERT_FALSE(session_cookie_matches("prsl_session=abc", "abcdef"));
    TEST_ASSERT_FALSE(session_cookie_matches("prsl_session=abcdef", "abc"));
    TEST_ASSERT_FALSE(session_cookie_matches("prsl_session=abc=def", "abc"));
}

void test_cookie_boundary(void) {
    TEST_ASSERT_FALSE(session_cookie_matches("foo=xprsl_session=abc", "abc"));
    TEST_ASSERT_FALSE(session_cookie_matches("xprsl_session=abc", "abc"));
    TEST_ASSERT_FALSE(session_cookie_matches("prsl_session =abc", "abc"));
    TEST_ASSERT_TRUE(session_cookie_matches("prsl_session=abc;", "abc"));
}

void test_cookie_duplicates(void) {
    TEST_ASSERT_TRUE(session_cookie_matches(
        "prsl_session=nope; prsl_session=abc", "abc"));
    TEST_ASSERT_TRUE(session_cookie_matches(
        "prsl_session=abcdef; prsl_session=abc", "abc"));
    TEST_ASSERT_FALSE(session_cookie_matches(
        "prsl_session=nope; prsl_session=wrong", "abc"));
}

void test_cookie_malformed(void) {
    TEST_ASSERT_FALSE(session_cookie_matches(NULL, "abc"));
    TEST_ASSERT_FALSE(session_cookie_matches("", "abc"));
    TEST_ASSERT_FALSE(session_cookie_matches("foo=1; bar=2", "abc"));
    TEST_ASSERT_FALSE(session_cookie_matches("prsl_session=abc", ""));
    TEST_ASSERT_FALSE(session_cookie_matches("prsl_session=abc", NULL));
    TEST_ASSERT_FALSE(session_cookie_matches("prsl_session=", "abc"));
    TEST_ASSERT_FALSE(session_cookie_matches("prsl_session", "abc"));
}

void test_origin_missing_and_null(void) {
    TEST_ASSERT_TRUE(origin_matches(NULL, "dev.local"));
    TEST_ASSERT_TRUE(origin_matches("", "dev.local"));
    TEST_ASSERT_FALSE(origin_matches("null", "dev.local"));
}

void test_origin_scheme_host_port(void) {
    TEST_ASSERT_TRUE(origin_matches("http://dev.local", "dev.local"));
    TEST_ASSERT_TRUE(origin_matches("https://dev.local", "dev.local"));
    TEST_ASSERT_TRUE(origin_matches("HTTP://DEV.LOCAL", "dev.local"));
    TEST_ASSERT_TRUE(origin_matches("HtTpS://Dev.Local", "dev.local"));
    TEST_ASSERT_FALSE(origin_matches("ftp://dev.local", "dev.local"));
    TEST_ASSERT_FALSE(origin_matches("http://other.local", "dev.local"));
    TEST_ASSERT_FALSE(origin_matches("http://dev.local", "other.local"));
    TEST_ASSERT_FALSE(origin_matches("http://dev.local:8080", "dev.local"));
    TEST_ASSERT_TRUE(origin_matches("http://dev.local:8080", "dev.local:8080"));
    TEST_ASSERT_TRUE(origin_matches("https://dev.local:8080", "dev.local:8080"));
    TEST_ASSERT_FALSE(origin_matches("http://dev.local/", "dev.local"));
    TEST_ASSERT_FALSE(origin_matches("http://dev.local", ""));
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_cookie_exact);
    RUN_TEST(test_cookie_prefix_and_suffix);
    RUN_TEST(test_cookie_boundary);
    RUN_TEST(test_cookie_duplicates);
    RUN_TEST(test_cookie_malformed);
    RUN_TEST(test_origin_missing_and_null);
    RUN_TEST(test_origin_scheme_host_port);
    return UNITY_END();
}
