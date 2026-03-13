# frozen_string_literal: true

require "net/http"
require "rexml/document"
require "rexml/xpath"
require "uri"

module AgentNewsletter
  module SourceAdapters
    class ArxivAdapter < BaseAdapter
      FetchError = Class.new(StandardError)

      DEFAULT_BASE_URL = "https://export.arxiv.org/api/query"
      DEFAULT_USER_AGENT = "agent-newsletter/0.1 (override-with-contact)"
      MIN_REQUEST_INTERVAL_SECONDS = 3
      SOURCE_AUTHORITY_SCORE = 95
      ATOM_NAMESPACE = "http://www.w3.org/2005/Atom"
      ARXIV_NAMESPACE = "http://arxiv.org/schemas/atom"
      NAMESPACES = {
        "atom" => ATOM_NAMESPACE,
        "arxiv" => ARXIV_NAMESPACE
      }.freeze
      AGENT_TERMS = [
        "AI agent",
        "AI agents",
        "agentic",
        "LLM agent",
        "LLM agents",
        "autonomous agent",
        "autonomous agents",
        "multi-agent",
        "multi-agent system",
        "tool-using agent"
      ].freeze
      CATEGORY_TERMS = %w[cs.AI cs.CL cs.LG cs.MA].freeze
      TAG_RULES = {
        "topic:ai-agents" => [
          /\bai agents?\b/i,
          /\bagentic\b/i,
          /\bllm agents?\b/i,
          /\bautonomous agents?\b/i,
          /\bmulti-agent\b/i
        ],
        "topic:tool-use" => [
          /\btool[- ]using\b/i,
          /\bfunction calling\b/i,
          /\btool invocation\b/i
        ],
        "topic:planning" => [
          /\bplanning\b/i,
          /\bplanner\b/i
        ],
        "topic:memory" => [
          /\bmemory\b/i,
          /\bepisodic\b/i
        ],
        "topic:retrieval" => [
          /\bretrieval\b/i,
          /\brag\b/i
        ],
        "topic:evaluation" => [
          /\bbenchmark\b/i,
          /\bevaluation\b/i,
          /\bjudge\b/i
        ],
        "candidate:library" => [
          /\bframework\b/i,
          /\blibrary\b/i,
          /\bsdk\b/i
        ],
        "candidate:api" => [
          /\bapis?\b/i
        ],
        "candidate:technique" => [
          /\btechnique\b/i,
          /\bmethod\b/i,
          /\bapproach\b/i
        ]
      }.freeze

      def initialize(
        query: nil,
        base_url: DEFAULT_BASE_URL,
        user_agent: DEFAULT_USER_AGENT,
        http_client: nil,
        clock: Time,
        sleep_fn: ->(seconds) { sleep(seconds) }
      )
        @query = query || default_query
        @base_url = base_url
        @user_agent = user_agent
        @http_client = http_client
        @clock = clock
        @sleep_fn = sleep_fn
        @last_request_at = nil
      end

      def source_name
        "arXiv"
      end

      def fetch(since:, until_time: @clock.now.utc, limit: 25)
        from_time = coerce_time(since)
        to_time = coerce_time(until_time)

        raise ArgumentError, "since must be before until_time" if from_time >= to_time
        raise ArgumentError, "limit must be positive" if limit.to_i <= 0

        query_uri = build_query_uri(since: from_time, until_time: to_time, limit: limit)
        response_body = request(query_uri)
        fetched_at = (@last_request_at || @clock.now).utc.iso8601

        parse_feed(
          response_body,
          requested_url: query_uri.to_s,
          fetched_at: fetched_at,
          fetch_window: {
            since: from_time.utc.iso8601,
            until: to_time.utc.iso8601
          }
        )
      end

      def build_query_uri(since:, until_time:, limit:)
        uri = URI(@base_url)
        uri.query = URI.encode_www_form(
          "search_query" => "#{@query} AND submittedDate:[#{arxiv_timestamp(since)} TO #{arxiv_timestamp(until_time)}]",
          "start" => 0,
          "max_results" => limit.to_i,
          "sortBy" => "submittedDate",
          "sortOrder" => "descending"
        )
        uri
      end

      private

      def default_query
        [
          "(" + CATEGORY_TERMS.map { |category| "cat:#{category}" }.join(" OR ") + ")",
          "(" + AGENT_TERMS.map { |term| %(all:"#{term}") }.join(" OR ") + ")"
        ].join(" AND ")
      end

      def request(uri)
        throttle!
        headers = {
          "User-Agent" => @user_agent,
          "Accept" => "application/atom+xml"
        }

        response_body = if @http_client
          @http_client.call(uri, headers)
        else
          perform_request(uri, headers)
        end

        @last_request_at = @clock.now
        response_body
      end

      def perform_request(uri, headers)
        request = Net::HTTP::Get.new(uri)
        headers.each { |key, value| request[key] = value }

        Net::HTTP.start(uri.host, uri.port, use_ssl: uri.scheme == "https") do |http|
          response = http.request(request)
          unless response.is_a?(Net::HTTPSuccess)
            raise FetchError, "arXiv API request failed with #{response.code}"
          end

          response.body
        end
      end

      def throttle!
        return if @last_request_at.nil?

        elapsed = @clock.now - @last_request_at
        wait_seconds = MIN_REQUEST_INTERVAL_SECONDS - elapsed
        @sleep_fn.call(wait_seconds) if wait_seconds.positive?
      end

      def parse_feed(xml, requested_url:, fetched_at:, fetch_window:)
        document = REXML::Document.new(xml)

        REXML::XPath.match(document, "//atom:entry", NAMESPACES).filter_map do |entry|
          normalize_entry(
            entry,
            requested_url: requested_url,
            fetched_at: fetched_at,
            fetch_window: fetch_window
          )
        end
      end

      def normalize_entry(entry, requested_url:, fetched_at:, fetch_window:)
        source_url = canonical_source_url(entry)
        title = text_at(entry, "atom:title")
        summary = text_at(entry, "atom:summary")
        published_at = parse_time(text_at(entry, "atom:published"))
        updated_at = parse_time(text_at(entry, "atom:updated"))
        authors = author_names(entry)
        primary_category = attribute_at(entry, "arxiv:primary_category", "term")
        categories = category_terms(entry)

        return if title.nil? || source_url.nil?

        SourceItem.new(
          external_id: external_id_for(source_url),
          source_name: source_name,
          source_type: "paper",
          name: title,
          source_url: source_url,
          summary: summary,
          published_at: published_at,
          updated_at: updated_at,
          authors: authors,
          tags: build_tags(
            title: title,
            summary: summary,
            primary_category: primary_category,
            categories: categories,
            comment: text_at(entry, "arxiv:comment")
          ),
          metadata: {
            primary_category: primary_category,
            categories: categories,
            pdf_url: pdf_url(entry),
            doi: text_at(entry, "arxiv:doi"),
            author_affiliations: author_affiliations(entry),
            comment: text_at(entry, "arxiv:comment"),
            query: @query,
            fetch_window: fetch_window,
            fetched_at: fetched_at,
            fetched_from_url: requested_url,
            source_provenance: {
              adapter_id: "arxiv",
              source_kind: "arxiv",
              source_name: source_name,
              query: @query,
              query_url: requested_url,
              requested_url: requested_url,
              fetched_from_url: requested_url,
              fetched_at: fetched_at
            }
          }.compact,
          source_authority_score: SOURCE_AUTHORITY_SCORE
        )
      end

      def build_tags(title:, summary:, primary_category:, categories:, comment:)
        haystack = [title, summary, comment].compact.join(" ")
        tags = ["source:arxiv", "content:paper", "curation:research"]
        tags << "topic:ai-agents" if haystack.match?(/\bagent/i)
        tags << "arxiv:primary:#{primary_category}" if primary_category
        tags.concat(categories.map { |category| "arxiv:category:#{category}" })

        TAG_RULES.each do |tag, patterns|
          tags << tag if patterns.any? { |pattern| haystack.match?(pattern) }
        end

        tags.uniq.sort
      end

      def canonical_source_url(entry)
        raw_url = text_at(entry, "atom:id")
        canonicalize_url(raw_url)
      end

      def pdf_url(entry)
        link = REXML::XPath.match(entry, "atom:link", NAMESPACES).find do |node|
          node.attributes["title"] == "pdf"
        end

        canonicalize_url(link&.attributes&.[]("href"))
      end

      def author_names(entry)
        REXML::XPath.match(entry, "atom:author/atom:name", NAMESPACES).filter_map do |node|
          normalized = normalize_text(node.text)
          normalized unless normalized.empty?
        end
      end

      def author_affiliations(entry)
        REXML::XPath.match(entry, "atom:author/arxiv:affiliation", NAMESPACES).filter_map do |node|
          normalized = normalize_text(node.text)
          normalized unless normalized.empty?
        end.uniq
      end

      def category_terms(entry)
        REXML::XPath.match(entry, "atom:category", NAMESPACES).filter_map do |node|
          term = node.attributes["term"]
          normalized = normalize_text(term)
          normalized unless normalized.empty?
        end.uniq.sort
      end

      def text_at(node, xpath)
        element = REXML::XPath.first(node, xpath, NAMESPACES)
        normalized = normalize_text(element&.text)
        normalized unless normalized.empty?
      end

      def attribute_at(node, xpath, attribute_name)
        element = REXML::XPath.first(node, xpath, NAMESPACES)
        return if element.nil?

        normalized = normalize_text(element.attributes[attribute_name])
        normalized unless normalized.empty?
      end

      def canonicalize_url(url)
        return if url.nil? || url.empty?

        url.sub(/\Ahttp:\/\//, "https://")
      end

      def external_id_for(source_url)
        URI(source_url).path.split("/").last
      end

      def coerce_time(value)
        case value
        when Time
          value.utc
        when String
          Time.iso8601(value).utc
        else
          raise ArgumentError, "expected Time or ISO8601 string"
        end
      end

      def arxiv_timestamp(time)
        coerce_time(time).strftime("%Y%m%d%H%M%S")
      end
    end
  end
end
