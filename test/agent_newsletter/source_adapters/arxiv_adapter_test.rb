# frozen_string_literal: true

require "test_helper"

class ArxivAdapterTest < Minitest::Test
  FIXTURE_PATH = File.expand_path("../../fixtures/arxiv_feed.xml", __dir__)
  FIXED_CLOCK = Class.new do
    def self.now
      Time.utc(2026, 3, 11, 0, 15, 0)
    end
  end

  def test_fetch_normalizes_arxiv_entries
    captured_uri = nil
    captured_headers = nil
    adapter = AgentNewsletter::SourceAdapters::ArxivAdapter.new(
      user_agent: "agent-newsletter-test/1.0 (test@example.com)",
      clock: FIXED_CLOCK,
      http_client: lambda do |uri, headers|
        captured_uri = uri
        captured_headers = headers
        File.read(FIXTURE_PATH)
      end,
      sleep_fn: ->(_seconds) {}
    )

    items = adapter.fetch(
      since: Time.utc(2026, 3, 10, 0, 0, 0),
      until_time: Time.utc(2026, 3, 11, 0, 0, 0),
      limit: 10
    )

    assert_equal "application/atom+xml", captured_headers["Accept"]
    assert_equal "agent-newsletter-test/1.0 (test@example.com)", captured_headers["User-Agent"]
    assert_equal 2, items.length
    assert_equal "submittedDate", URI.decode_www_form(captured_uri.query).to_h["sortBy"]

    first_item = items.first
    assert_equal "2603.12345", first_item.external_id
    assert_equal "arXiv", first_item.source_name
    assert_equal "paper", first_item.source_type
    assert_equal "Coordinating LLM Agents with Retrieval-Augmented Planning", first_item.name
    assert_equal "https://arxiv.org/abs/2603.12345", first_item.source_url
    assert_equal Time.utc(2026, 3, 10, 12, 30, 0), first_item.published_at
    assert_equal Time.utc(2026, 3, 10, 13, 45, 0), first_item.updated_at
    assert_equal ["Ada Lovelace", "Grace Hopper"], first_item.authors
    assert_equal 95, first_item.source_authority_score
    assert_equal "cs.AI", first_item.metadata[:primary_category]
    assert_equal ["cs.AI", "cs.CL"], first_item.metadata[:categories]
    assert_equal "https://arxiv.org/pdf/2603.12345v1", first_item.metadata[:pdf_url]
    assert_equal "2026-03-11T00:15:00Z", first_item.metadata[:fetched_at]
    assert_equal captured_uri.to_s, first_item.metadata[:fetched_from_url]
    assert_equal(
      { since: "2026-03-10T00:00:00Z", until: "2026-03-11T00:00:00Z" },
      first_item.metadata[:fetch_window]
    )
    assert_equal "arxiv", first_item.metadata[:source_provenance][:adapter_id]
    assert_equal "arxiv", first_item.metadata[:source_provenance][:source_kind]
    assert_equal "arXiv", first_item.metadata[:source_provenance][:source_name]
    assert_equal captured_uri.to_s, first_item.metadata[:source_provenance][:query_url]
    assert_equal "2026-03-11T00:15:00Z", first_item.metadata[:source_provenance][:fetched_at]
  end

  def test_fetch_builds_agent_query_window
    captured_uri = nil
    adapter = AgentNewsletter::SourceAdapters::ArxivAdapter.new(
      http_client: lambda do |uri, _headers|
        captured_uri = uri
        File.read(FIXTURE_PATH)
      end,
      sleep_fn: ->(_seconds) {}
    )

    adapter.fetch(
      since: "2026-03-10T00:00:00Z",
      until_time: "2026-03-11T00:00:00Z",
      limit: 5
    )

    params = URI.decode_www_form(captured_uri.query).to_h

    assert_equal "descending", params["sortOrder"]
    assert_equal "5", params["max_results"]
    assert_includes params["search_query"], 'all:"AI agent"'
    assert_includes params["search_query"], "cat:cs.AI"
    assert_includes params["search_query"], "submittedDate:[20260310000000 TO 20260311000000]"
  end

  def test_fetch_tags_entries_for_downstream_curation
    adapter = AgentNewsletter::SourceAdapters::ArxivAdapter.new(
      http_client: ->(_uri, _headers) { File.read(FIXTURE_PATH) },
      sleep_fn: ->(_seconds) {}
    )

    items = adapter.fetch(
      since: Time.utc(2026, 3, 10, 0, 0, 0),
      until_time: Time.utc(2026, 3, 11, 0, 0, 0),
      limit: 10
    )

    first_item = items.first
    second_item = items.last

    assert_includes first_item.tags, "source:arxiv"
    assert_includes first_item.tags, "content:paper"
    assert_includes first_item.tags, "topic:ai-agents"
    assert_includes first_item.tags, "topic:planning"
    assert_includes first_item.tags, "topic:retrieval"
    assert_includes first_item.tags, "topic:memory"
    assert_includes first_item.tags, "topic:evaluation"
    assert_includes first_item.tags, "candidate:library"
    assert_includes first_item.tags, "candidate:technique"
    assert_includes first_item.tags, "arxiv:primary:cs.AI"

    assert_includes second_item.tags, "topic:evaluation"
    assert_includes second_item.tags, "candidate:api"
    assert_includes second_item.tags, "arxiv:primary:cs.MA"
  end

  def test_fetch_rejects_invalid_time_window
    adapter = AgentNewsletter::SourceAdapters::ArxivAdapter.new(
      http_client: ->(_uri, _headers) { File.read(FIXTURE_PATH) },
      sleep_fn: ->(_seconds) {}
    )

    error = assert_raises(ArgumentError) do
      adapter.fetch(
        since: Time.utc(2026, 3, 11, 0, 0, 0),
        until_time: Time.utc(2026, 3, 10, 0, 0, 0),
        limit: 10
      )
    end

    assert_equal "since must be before until_time", error.message
  end
end
