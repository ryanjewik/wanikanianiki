# The event-driven half: the API announces what happened on its own bus, and a
# rule decides who cares. See app/services/events.py for the events themselves.

resource "aws_cloudwatch_event_bus" "main" {
  name = var.name
}

# Both events mean "the lesson queue may need topping up" — one drains it, the
# other adds material to fill it from. The worker counts before it generates,
# so routing an event that turns out not to need a top-up costs one COUNT.
resource "aws_cloudwatch_event_rule" "lesson_demand" {
  name           = "${var.name}-lesson-demand"
  description    = "Top up generated lessons when the queue is drawn down or the deck grows"
  event_bus_name = aws_cloudwatch_event_bus.main.name

  event_pattern = jsonencode({
    # Must match SOURCE and the detail types in app/services/events.py.
    source        = ["kanji-workshop.api"]
    "detail-type" = ["LessonBundleClaimed", "VocabConfirmed"]
  })
}

resource "aws_cloudwatch_event_target" "lesson_demand" {
  rule           = aws_cloudwatch_event_rule.lesson_demand.name
  event_bus_name = aws_cloudwatch_event_bus.main.name
  arn            = aws_lambda_function.fn["lessons"].arn
}

resource "aws_lambda_permission" "lesson_demand" {
  statement_id  = "AllowLessonDemandRule"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.fn["lessons"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.lesson_demand.arn
}
