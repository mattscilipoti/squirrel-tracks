# frozen_string_literal: true

class SessionSerializer < ActiveModel::Serializer
  attributes :id, :status, :created_at, :updated_at

  has_many :tasks, serializer: TaskSerializer
end
