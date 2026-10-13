require 'rails_helper'

RSpec.describe Task, type: :model do
  describe 'associations' do
    it { is_expected.to belong_to(:session) }
  end

  describe 'validations' do
    it { is_expected.to validate_presence_of(:name) }
    it { is_expected.to validate_presence_of(:session_id) }
    it { is_expected.to validate_numericality_of(:duration_minutes).only_integer.is_greater_than_or_equal_to(0).allow_nil }
  end

  describe '#create' do
    it 'requires a task name' do
      session = create(:session)
      task = build(:task, name: nil, session: session)
      expect(task).not_to be_valid
      expect(task.errors[:name]).to include("can't be blank")
    end

    it 'requires a session' do
      task = build(:task, session: nil)
      expect(task).not_to be_valid
      expect(task.errors[:session_id]).to include("can't be blank")
    end

    it 'allows duration_minutes to be 0 or positive' do
      session = create(:session)
      task1 = build(:task, session: session, duration_minutes: 0)
      task2 = build(:task, session: session, duration_minutes: 15)
      
      expect(task1).to be_valid
      expect(task2).to be_valid
    end

    it 'rejects negative duration_minutes' do
      session = create(:session)
      task = build(:task, session: session, duration_minutes: -5)
      expect(task).not_to be_valid
      expect(task.errors[:duration_minutes]).to include("must be greater than or equal to 0")
    end

    it 'allows nil duration_minutes' do
      session = create(:session)
      task = build(:task, session: session, duration_minutes: nil)
      expect(task).to be_valid
    end

    it 'creates a valid task with all required fields' do
      session = create(:session)
      task = create(:task, session: session, name: 'Document API', duration_minutes: 25)
      
      expect(task).to be_persisted
      expect(task.name).to eq('Document API')
      expect(task.duration_minutes).to eq(25)
      expect(task.session_id).to eq(session.id)
    end
  end
end
